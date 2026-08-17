import type { FastifyPluginAsync } from 'fastify';
import {
  attributedTo,
  brandEntities,
  db,
  dimensionScores,
  sentimentResults,
  signals,
  territoryFilter,
} from '@project-signal/db';
import {
  brandImpact,
  clusterTopics,
  compositeScore,
  counterfactual,
  gapTo,
  HALF_LIFE_DAYS,
  median,
  parseWeights,
  project,
  resolveTarget,
  scoreAllDimensions,
  type Benchmarks,
  type ScoredItem,
} from '@project-signal/scoring';
import {
  TERRITORY_ALL,
  TERRITORY_LABELS,
  type Dimension,
  type SentimentLabel,
  type Territory,
} from '@project-signal/shared-types';
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import { requireBrandAccess, requireRole } from '../plugins/auth.js';

/**
 * The action roadmap — what to fix, what it is worth, and what to aim at.
 *
 * WHAT THIS REPLACES. The view ranked subjects by damage and stopped: "12 signals mention this and
 * it accounts for 34% of the damage" restates the complaint and proposes nothing. The owner's
 * words: *"that just goes back to telling me what the feedback is. There's nothing there that is
 * an actual plan."*
 *
 * EVERY NUMBER HERE IS MEASURED OR COMPUTED, NONE ARE IMPORTED. The Brand Perception Index is
 * defined by this codebase, so no external body publishes a benchmark for it and any "industry
 * average of 68" would be invented — in the one place a client is most likely to quote us. The
 * benchmarks are therefore the tracked competitor set (same pipeline, same scoring), the brand's
 * own strongest territory, or a target the owner set deliberately. All three are checkable inside
 * the product by the person reading them.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = HALF_LIFE_DAYS * 4;

/** How many actions the roadmap ranks. Wider than Brand impact's three — this is the work list. */
const DEFAULT_ACTION_LIMIT = 8;

const TARGET_SCHEMA = {
  type: 'object',
  nullable: true,
  properties: {
    value: { type: 'number' },
    source: { type: 'string' },
    label: { type: 'string' },
  },
};

const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    volume: { type: 'integer' },
    sentiment: { type: 'number' },
    damage: { type: 'number' },
    damageShare: { type: 'number' },
    dimensions: { type: 'array', items: { type: 'string' } },
    ifResolved: {
      type: 'object',
      nullable: true,
      properties: {
        from: { type: 'number' },
        to: { type: 'number' },
        delta: { type: 'number' },
        affectedSignals: { type: 'integer' },
      },
    },
  },
};

/** Reads the scored items a brand's index is built from, for one territory. */
async function readItems(
  tenantId: string,
  brandEntityId: string,
  asOf: Date,
  territory?: string,
): Promise<ScoredItem[]> {
  const since = new Date(asOf.getTime() - LOOKBACK_DAYS * MS_PER_DAY);
  const rows = await db
    .get()
    .select({
      signalId: signals.id,
      publishedAt: signals.publishedAt,
      score: sentimentResults.score,
      confidence: sentimentResults.confidence,
      label: sentimentResults.label,
      dimensions: sentimentResults.dimensions,
      topics: sentimentResults.topics,
    })
    .from(signals)
    .innerJoin(sentimentResults, eq(sentimentResults.signalId, signals.id))
    .where(
      and(
        attributedTo(brandEntityId, tenantId),
        territoryFilter(territory),
        gte(signals.publishedAt, since),
      ),
    );

  return rows.map((r) => ({
    signalId: r.signalId,
    publishedAt: r.publishedAt,
    score: r.score ?? 0,
    confidence: r.confidence ?? 0,
    label: (r.label ?? 'neutral') as SentimentLabel,
    dimensions: (r.dimensions ?? []) as Dimension[],
    topics: r.topics ?? [],
  }));
}

/**
 * The benchmarks, all of them measured inside this product.
 *
 * COMPETITORS come through the same pipeline and the same scorer as the brand, which is what makes
 * the comparison fair — it is not an external figure of unknown provenance, it is the same
 * calculation applied to a rival's public signals.
 *
 * INTERNAL BEST is the brand's own strongest territory. Often the most actionable of the three: a
 * gap between two of your own markets is a real difference with a real cause, and somebody in the
 * building already knows what it is.
 */
/* Exported for testing, like `descendantsOf` in portfolio.ts: the benchmark logic is where a
   wrong number would be most damaging and least visible, so it is worth exercising directly. */
export async function readBenchmarks(
  tenantId: string,
  brandEntityId: string,
  latestDate: string | null,
): Promise<Benchmarks> {
  const database = db.get();

  /* Competitors: every entity in the tenant the owner marked as not theirs. Their latest
     composite comes from the same `dimension_scores` rows the brand's own does. */
  const competitors = await database
    .select({
      id: brandEntities.id,
      name: brandEntities.name,
      weights: brandEntities.dimensionWeights,
    })
    .from(brandEntities)
    .where(
      and(
        eq(brandEntities.tenantId, tenantId),
        eq(brandEntities.isOwned, false),
        ne(brandEntities.id, brandEntityId),
      ),
    );

  const competitorScores: number[] = [];
  for (const c of competitors) {
    const rows = await database
      .select({
        dimension: dimensionScores.dimension,
        score: dimensionScores.score,
        signalCount: dimensionScores.signalCount,
      })
      .from(dimensionScores)
      .where(
        and(
          eq(dimensionScores.tenantId, tenantId),
          eq(dimensionScores.brandEntityId, c.id),
          eq(dimensionScores.territory, TERRITORY_ALL),
        ),
      )
      .orderBy(desc(dimensionScores.date))
      .limit(5);
    if (rows.length === 0) continue;
    const composite = compositeScore(
      rows.map((r) => ({
        dimension: r.dimension as Dimension,
        score: r.score,
        signalCount: r.signalCount,
      })),
      parseWeights(c.weights),
    );
    if (composite !== null) competitorScores.push(composite);
  }

  /* Internal best: the brand's own strongest territory on the latest rollup date. Excludes the
     `'all'` aggregate, which is the thing being compared rather than a comparator. */
  let internalBest: Benchmarks['internalBest'] = null;
  if (latestDate) {
    const byTerritory = await database
      .select({
        territory: dimensionScores.territory,
        dimension: dimensionScores.dimension,
        score: dimensionScores.score,
        signalCount: dimensionScores.signalCount,
      })
      .from(dimensionScores)
      .where(
        and(
          eq(dimensionScores.tenantId, tenantId),
          eq(dimensionScores.brandEntityId, brandEntityId),
          eq(dimensionScores.date, latestDate),
          ne(dimensionScores.territory, TERRITORY_ALL),
        ),
      );

    const grouped = new Map<
      string,
      { dimension: Dimension; score: number; signalCount: number }[]
    >();
    for (const row of byTerritory) {
      const bucket = grouped.get(row.territory) ?? [];
      bucket.push({
        dimension: row.dimension as Dimension,
        score: row.score,
        signalCount: row.signalCount,
      });
      grouped.set(row.territory, bucket);
    }

    for (const [territory, rollups] of grouped) {
      /* `unknown` is excluded as a comparator on purpose. "Beat your unclassified feeds" is not a
         goal anyone can act on, and it would frequently be the strongest scope simply because it
         holds the most volume. */
      if (territory === 'unknown') continue;
      const composite = compositeScore(rollups);
      if (composite === null) continue;
      if (internalBest === null || composite > internalBest.value) {
        internalBest = {
          value: composite,
          label: TERRITORY_LABELS[territory as Territory] ?? territory,
        };
      }
    }
  }

  return {
    competitorMedian: median(competitorScores),
    competitorBest: competitorScores.length ? Math.max(...competitorScores) : null,
    competitorCount: competitorScores.length,
    internalBest,
  };
}

const roadmapRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/brands/:id/roadmap',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          'What to fix, what each is worth as a computed counterfactual, the target and where it came from, and where the index goes with no action. Every figure is measured or computed inside the product — none is an imported "industry standard", because none exists for this index.',
        params: { type: 'object', properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          properties: {
            territory: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 20, default: DEFAULT_ACTION_LIMIT },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              current: { type: 'number', nullable: true },
              target: TARGET_SCHEMA,
              gap: { type: 'number', nullable: true },
              benchmarks: {
                type: 'object',
                properties: {
                  competitorMedian: { type: 'number', nullable: true },
                  competitorBest: { type: 'number', nullable: true },
                  competitorCount: { type: 'integer' },
                  internalBest: {
                    type: 'object',
                    nullable: true,
                    properties: { value: { type: 'number' }, label: { type: 'string' } },
                  },
                },
              },
              projection: {
                type: 'object',
                nullable: true,
                properties: {
                  assumption: { type: 'string' },
                  daysToTarget: { type: 'integer', nullable: true },
                  decliningWithoutAction: { type: 'boolean' },
                  points: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: { day: { type: 'integer' }, score: { type: 'number' } },
                    },
                  },
                },
              },
              actions: { type: 'array', items: ACTION_SCHEMA },
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { territory, limit = DEFAULT_ACTION_LIMIT } = request.query as {
        territory?: string;
        limit?: number;
      };
      const tenantId = request.user.tenantId;
      const asOf = new Date();
      const database = db.get();

      const [brand] = await database
        .select({ weights: brandEntities.dimensionWeights, targetScore: brandEntities.targetScore })
        .from(brandEntities)
        .where(and(eq(brandEntities.id, id), eq(brandEntities.tenantId, tenantId)));

      const weights = parseWeights(brand?.weights);
      const items = await readItems(tenantId, id, asOf, territory);
      const current = compositeScore(scoreAllDimensions(items, asOf), weights);

      const [latest] = await database
        .select({ date: dimensionScores.date })
        .from(dimensionScores)
        .where(
          and(
            eq(dimensionScores.tenantId, tenantId),
            eq(dimensionScores.brandEntityId, id),
            eq(dimensionScores.territory, territory || TERRITORY_ALL),
          ),
        )
        .orderBy(desc(dimensionScores.date))
        .limit(1);

      const benchmarks = await readBenchmarks(tenantId, id, latest?.date ?? null);
      const target = resolveTarget(brand?.targetScore ?? null, benchmarks);

      const clusters = clusterTopics(items, asOf);
      const ranked = brandImpact(clusters, limit);
      const totalDamage = clusters.reduce((sum, c) => sum + c.damage, 0);

      const projection = project(items, asOf, target?.value ?? null, weights);

      return {
        current,
        target,
        gap: gapTo(current, target),
        benchmarks,
        projection: projection
          ? {
              /* Stated, not implied. The assumption is false in reality — signals keep arriving —
                 and its value is as a bound rather than a forecast. A projection whose assumption
                 is not on screen beside it will be read as a prediction. */
              assumption: 'no new signals arrive',
              daysToTarget: projection.daysToTarget,
              decliningWithoutAction: projection.decliningWithoutAction,
              points: projection.points,
            }
          : null,
        actions: ranked.map((c) => ({
          topic: c.topic,
          volume: c.volume,
          sentiment: c.sentiment,
          damage: c.damage,
          damageShare: totalDamage > 0 ? (c.damage / totalDamage) * 100 : 0,
          dimensions: c.dimensions,
          /* THE CEILING, NOT A FORECAST — what this subject is worth if nobody were negative about
             it any more. It says nothing about how much is achievable or when, and the UI copy has
             to keep saying so: the fabricated "+3.4 pts" this replaces was believed precisely
             because it looked like a prediction. */
          ifResolved: counterfactual(items, c.topic, asOf, weights),
        })),
      };
    },
  );

  /**
   * PATCH /brands/:id/target — set or clear the brand's target index.
   *
   * `null` clears it, which is different from omitting the field: clearing returns the brand to a
   * competitor-derived default, and there has to be a way back from a target set in error.
   */
  fastify.patch(
    '/brands/:id/target',
    {
      preHandler: requireRole('admin', 'owner'),
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        body: {
          type: 'object',
          properties: { targetScore: { type: 'number', nullable: true, minimum: 0, maximum: 100 } },
          required: ['targetScore'],
        },
        response: {
          200: {
            type: 'object',
            properties: { id: { type: 'string' }, targetScore: { type: 'number', nullable: true } },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { targetScore } = request.body as { targetScore: number | null };

      /* Tenant-scoped in the WHERE, not just checked beforehand. `requireRole` proves the caller
         is an admin somewhere; only this clause proves the brand is theirs. */
      const [row] = await db
        .get()
        .update(brandEntities)
        .set({ targetScore, updatedAt: new Date() })
        .where(and(eq(brandEntities.id, id), eq(brandEntities.tenantId, request.user.tenantId)))
        .returning({ id: brandEntities.id, targetScore: brandEntities.targetScore });

      if (!row) return reply.notFound('Brand not found');
      return row;
    },
  );
};

export default roadmapRoutes;
