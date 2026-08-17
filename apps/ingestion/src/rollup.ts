import {
  db,
  attributedTo,
  brandEntities,
  signals,
  sentimentResults,
} from '@project-signal/db';
import { HALF_LIFE_DAYS, scoreAllDimensions, type ScoredItem } from '@project-signal/scoring';
import { TERRITORY_ALL, type Dimension, type SentimentLabel } from '@project-signal/shared-types';
import { and, eq, gte } from 'drizzle-orm';
import { dimensionScores } from '@project-signal/db';

/**
 * How far back the rollup reads.
 *
 * The decay is a half-life, not a window, so contributions never reach zero — but past four
 * half-lives an item carries under 1/16th weight, and reading the entire history on every daily
 * run would grow without bound. Four half-lives is the cut-off.
 */
const LOOKBACK_DAYS = HALF_LIFE_DAYS * 4;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

  const brands = await database
    .select({
      id: brandEntities.id,
      tenantId: brandEntities.tenantId,
      weights: brandEntities.dimensionWeights,
    })
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
    const partitions = new Map<string, (ScoredItem & { territory: string })[]>([
      [TERRITORY_ALL, items],
    ]);
    for (const item of items) {
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
