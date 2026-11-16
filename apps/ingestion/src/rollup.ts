import { db, attributedTo, brandEntities, signals, sentimentResults } from '@project-signal/db';
import {
  LOOKBACK_DAYS,
  MS_PER_DAY,
  scoreAllDimensions,
  type ScoredItem,
} from '@project-signal/scoring';
import { TERRITORY_ALL, type Dimension, type SentimentLabel } from '@project-signal/shared-types';
import { and, eq, gte } from 'drizzle-orm';
import { dimensionScores } from '@project-signal/db';

/*
 * How far back the rollup reads: `LOOKBACK_DAYS` from @project-signal/scoring — four half-lives,
 * shared with the projection so both describe the same window.
 *
 * The rollup is scheduled HOURLY (infra-aws/stack/scheduler.tf). It writes one row per brand ×
 * dimension × territory per calendar day and upserts, so the hourly runs refine today's row rather
 * than adding to it.
 */

/** `date` columns are plain dates; normalise to YYYY-MM-DD in UTC. */
function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Computes daily dimension rollups for every brand and upserts them into `dimension_scores`.
 *
 * This is Epic 11's core: without it the table is never written and every dimension endpoint
 * returns an empty array (KNOWN-GAPS #10). Idempotent — the unique constraint on
 * (brand_entity_id, date, dimension, territory) means re-running for the same day overwrites
 * rather than duplicating, so a retried or manually re-triggered run is safe.
 *
 * Writes one set of rows per TERRITORY the brand has signals from, plus the `'all'` aggregate.
 */
/* `attributedTo` used to be defined here and used by this file alone, while every read path in
   the API filtered on the foreign key only — so the index and the evidence behind it came from
   different populations. It now lives in `@project-signal/db` so there is exactly one definition;
   see the comment there for the full reasoning. */

export async function rollupDimensionScores(
  asOf: Date = new Date(),
): Promise<{ brands: number; rows: number }> {
  const database = db.get();
  const since = new Date(asOf.getTime() - LOOKBACK_DAYS * MS_PER_DAY);
  const date = toDateKey(asOf);

  /* Dimension weights are NOT read here: the rollup stores per-dimension scores only, and the
     composite that weights them is computed on read in the API. */
  const brands = await database
    .select({ id: brandEntities.id, tenantId: brandEntities.tenantId })
    .from(brandEntities);

  let rows = 0;

  for (const brand of brands) {
    const scored = await database
      .select({
        signalId: signals.id,
        publishedAt: signals.publishedAt,
        territory: signals.territory,
        score: sentimentResults.score,
        confidence: sentimentResults.confidence,
        label: sentimentResults.label,
        dimensions: sentimentResults.dimensions,
        topics: sentimentResults.topics,
      })
      .from(signals)
      .innerJoin(sentimentResults, eq(sentimentResults.signalId, signals.id))
      .where(and(attributedTo(brand.id, brand.tenantId), gte(signals.publishedAt, since)));

    const items: (ScoredItem & { territory: string })[] = scored.map((row) => ({
      signalId: row.signalId,
      publishedAt: row.publishedAt,
      territory: row.territory,
      score: row.score ?? 0,
      // A missing confidence must not silently become full confidence.
      confidence: row.confidence ?? 0,
      label: (row.label ?? 'neutral') as SentimentLabel,
      dimensions: (row.dimensions ?? []) as Dimension[],
      topics: row.topics ?? [],
    }));

    /**
     * One read, partitioned in memory — not one query per territory.
     *
     * The alternative multiplies the hottest query in the pipeline by the number of territories a
     * brand collects from, for data already in hand. Partitioning here costs a pass over an array.
     *
     * `TERRITORY_ALL` is always computed, from every item regardless of territory, so the
     * aggregate cannot drift from the parts. Territories are derived from the signals actually
     * present rather than from the full vocabulary — a brand with no Australian feed gets no
     * Australian rows, which is different from getting a row of zeroes.
     */
    /* A COPY for the aggregate, never `items` itself. With the same array as both the aggregate
       and the thing being iterated, a signal whose territory was literally 'all' would be pushed
       onto the array under iteration, and the loop would never end. 'all' is kept out of
       `signals.territory` by the shared vocabulary rather than by a database constraint, so the
       rollup does not rely on that: such a row still counts towards the aggregate (it is a real
       signal) but never forms a partition of its own. */
    const partitions = new Map<string, (ScoredItem & { territory: string })[]>([
      [TERRITORY_ALL, [...items]],
    ]);
    for (const item of items) {
      if (item.territory === TERRITORY_ALL) continue;
      const bucket = partitions.get(item.territory);
      if (bucket) bucket.push(item);
      else partitions.set(item.territory, [item]);
    }

    for (const [territory, partition] of partitions) {
      const rollups = scoreAllDimensions(partition, asOf);
      if (rollups.length === 0) continue;

      for (const rollup of rollups) {
        await database
          .insert(dimensionScores)
          .values({
            tenantId: brand.tenantId,
            brandEntityId: brand.id,
            date,
            territory,
            dimension: rollup.dimension,
            score: rollup.score,
            signalCount: rollup.signalCount,
          })
          /* The conflict target MUST match the unique constraint exactly. It gained `territory`
             in migration 0014, and leaving this at three columns raises "no unique or exclusion
             constraint matching the ON CONFLICT specification" on every single run — a hard
             failure of the whole rollup, not a degraded one. */
          .onConflictDoUpdate({
            target: [
              dimensionScores.brandEntityId,
              dimensionScores.date,
              dimensionScores.dimension,
              dimensionScores.territory,
            ],
            set: { score: rollup.score, signalCount: rollup.signalCount },
          });
        rows++;
      }
    }
  }

  return { brands: brands.length, rows };
}
