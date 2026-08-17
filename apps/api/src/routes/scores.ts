import type { FastifyPluginAsync } from 'fastify';
import {
  attributedTo,
  db,
  brandEntities,
  dimensionScores,
  signals,
  sentimentResults,
} from '@project-signal/db';
import {
  brandImpact,
  clusterTopics,
  compositeScore,
  DIMENSIONS,
  HALF_LIFE_DAYS,
  parseWeights,
  topicsForDimension,
  topStrengths,
  type DimensionRollup,
  type ScoredItem,
} from '@project-signal/scoring';
import type { Dimension, SentimentLabel } from '@project-signal/shared-types';
import { and, asc, count, desc, eq, gte, lt, lte, max, sql } from 'drizzle-orm';
import { requireBrandAccess } from '../plugins/auth.js';
import { sourceConfigs } from '@project-signal/db';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default history window for the trend endpoints. */
const DEFAULT_HISTORY_DAYS = 90;

/** How far back a delta looks for a comparison point — the dashboard reports week-on-week. */
const COMPARISON_DAYS = 7;

/** Items older than four half-lives carry under 1/16th weight; reading further is waste. */
const BRAND_IMPACT_LOOKBACK_DAYS = HALF_LIFE_DAYS * 4;

/**
 * How many clusters `/topics` returns by default.
 *
 * Deliberately larger than Brand impact's three. That endpoint is a summary and three is the
 * spec's number; this one is the drill-down's evidence list, where truncating hides topics the
 * user was told exist.
 */
const DEFAULT_TOPIC_LIMIT = 12;

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return toDateKey(new Date(Date.now() - n * MS_PER_DAY));
}

const DIMENSION_ROW = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    score: { type: 'number' },
    date: { type: 'string' },
    signalCount: { type: 'integer' },
  },
};

const CLUSTER_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    volume: { type: 'integer' },
    negativity: { type: 'number' },
    positivity: { type: 'number' },
    recency: { type: 'number' },
    damage: { type: 'number' },
    strength: { type: 'number' },
    sentiment: { type: 'number' },
    dimensions: { type: 'array', items: { type: 'string' } },
  },
};

const scoresRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Dimension history, for the trend chart.
   *
   * Now that the rollup writes a row per brand × dimension × day, this table grows without
   * bound — it previously returned every row it had, which was harmless only because it was
   * always empty. Defaults to the last 90 days.
   */
  fastify.get(
    '/brands/:id/dimension-scores',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Inclusive YYYY-MM-DD. Defaults to 90 days ago.' },
            to: { type: 'string', description: 'Inclusive YYYY-MM-DD. Defaults to today.' },
          },
        },
        response: { 200: { type: 'array', items: DIMENSION_ROW } },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { from, to } = request.query as { from?: string; to?: string };

      return db
        .get()
        .select({
          dimension: dimensionScores.dimension,
          score: dimensionScores.score,
          date: dimensionScores.date,
          signalCount: dimensionScores.signalCount,
        })
        .from(dimensionScores)
        .where(
          and(
            eq(dimensionScores.tenantId, request.user.tenantId),
            eq(dimensionScores.brandEntityId, id),
            gte(dimensionScores.date, from ?? daysAgo(DEFAULT_HISTORY_DAYS)),
            lte(dimensionScores.date, to ?? toDateKey(new Date())),
          ),
        )
        .orderBy(asc(dimensionScores.date), asc(dimensionScores.dimension));
    },
  );

  /**
   * The Brand Perception Index headline: the composite for the most recent rollup, its
   * per-dimension breakdown, and the comparison point roughly a week earlier.
   *
   * `score` is null when the brand has no rollup at all — a brand that has never been scored
   * is not a brand scoring zero, and the dashboard needs to tell those apart.
   */
  fastify.get(
    '/brands/:id/score',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        response: {
          200: {
            type: 'object',
            properties: {
              score: { type: 'number', nullable: true },
              previousScore: { type: 'number', nullable: true },
              date: { type: 'string', nullable: true },
              previousDate: { type: 'string', nullable: true },
              dimensions: { type: 'array', items: DIMENSION_ROW },
              /* The SAME dimensions at `previousDate`. Already computed here to derive
                 `previousScore`, and previously discarded — which is why every dimension bar on
                 the dashboard rendered `▲ +0`: with no previous row to compare against, the view
                 fell back to comparing each dimension with itself. Returning them is what lets a
                 per-dimension delta be real, or be honestly reported as absent. */
              previousDimensions: { type: 'array', items: DIMENSION_ROW },
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const database = db.get();

      const [brand] = await database
        .select({ weights: brandEntities.dimensionWeights })
        .from(brandEntities)
        .where(and(eq(brandEntities.id, id), eq(brandEntities.tenantId, request.user.tenantId)));

      const rows = await database
        .select({
          dimension: dimensionScores.dimension,
          score: dimensionScores.score,
          date: dimensionScores.date,
          signalCount: dimensionScores.signalCount,
        })
        .from(dimensionScores)
        .where(
          and(
            eq(dimensionScores.tenantId, request.user.tenantId),
            eq(dimensionScores.brandEntityId, id),
          ),
        )
        .orderBy(desc(dimensionScores.date));

      if (rows.length === 0) {
        return {
          score: null,
          previousScore: null,
          date: null,
          previousDate: null,
          dimensions: [],
          previousDimensions: [],
        };
      }

      const weights = parseWeights(brand?.weights);
      const latestDate = rows[0]!.date;
      const current = rows.filter((r) => r.date === latestDate);

      // The most recent rollup at least a week older than the latest. Rollups are daily, but a
      // gap (an outage, a brand added mid-week) must not silently compare against yesterday.
      const cutoff = toDateKey(
        new Date(new Date(latestDate).getTime() - COMPARISON_DAYS * MS_PER_DAY),
      );
      const previousDate = rows.find((r) => r.date <= cutoff)?.date ?? null;
      const previous = previousDate ? rows.filter((r) => r.date === previousDate) : [];

      const asRollups = (src: typeof rows): DimensionRollup[] =>
        src.map((r) => ({
          dimension: r.dimension as Dimension,
          score: r.score,
          signalCount: r.signalCount,
        }));

      return {
        score: compositeScore(asRollups(current), weights),
        previousScore: previous.length ? compositeScore(asRollups(previous), weights) : null,
        date: latestDate,
        previousDate,
        dimensions: current,
        previousDimensions: previous,
      };
    },
  );

  /**
   * Brand impact: the topic clusters doing the most damage.
   *
   * Computed on read rather than persisted. Clusters have no table, and deriving them from
   * `sentiment_results` keeps the topic taxonomy free to change without a migration — the model
   * invents topic tags per signal, so a stored cluster would be stale the moment tagging
   * shifted. Bounded by the same four-half-life lookback the rollup uses.
   */
  fastify.get(
    '/brands/:id/brand-impact',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 3 } },
        },
        response: { 200: { type: 'array', items: CLUSTER_SCHEMA } },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { limit = 3 } = request.query as { limit?: number };
      const asOf = new Date();
      const items = await readScoredItems(request.user.tenantId, id, asOf);

      return brandImpact(clusterTopics(items, asOf), limit);
    },
  );

  /**
   * Every topic cluster for the brand, optionally narrowed to one dimension.
   *
   * The drill-down's second level reads THIS, not `/brand-impact`. It used to read
   * `/brand-impact` and filter the result client-side, which meant a dimension could report
   * "5 signals contributed" at level 1 and "no topic cluster has been tagged to it" at level 2 —
   * because `brandImpact` excludes zero-damage clusters by design, and a dimension people are
   * POSITIVE about has nothing but zero-damage clusters. The better a dimension performed, the
   * more certain its drill-down was to be empty.
   *
   * `limit` defaults higher than Brand impact's three: this is the evidence view, not the
   * executive summary, and truncating it to three reintroduces the same silent gap.
   */
  fastify.get(
    '/brands/:id/topics',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          properties: {
            dimension: {
              type: 'string',
              enum: [...DIMENSIONS],
              description: 'Return only clusters the scorer tagged to this dimension.',
            },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: DEFAULT_TOPIC_LIMIT },
          },
        },
        response: { 200: { type: 'array', items: CLUSTER_SCHEMA } },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { dimension, limit = DEFAULT_TOPIC_LIMIT } = request.query as {
        dimension?: Dimension;
        limit?: number;
      };
      const asOf = new Date();
      const clusters = clusterTopics(await readScoredItems(request.user.tenantId, id, asOf), asOf);

      /* Unfiltered, the clusters arrive damage-sorted from `clusterTopics`. Re-sorting by the
         same presence measure the dimension view uses keeps the two consistent — a caller asking
         for "the brand's topics" should not get them ranked by negativity alone. */
      if (!dimension) {
        return clusters
          .slice()
          .sort((a, b) => b.volume * b.recency - a.volume * a.recency)
          .slice(0, limit);
      }
      return topicsForDimension(clusters, dimension, limit);
    },
  );

  /** The mirror of /brand-impact: what is working, ranked by the same construction. */
  fastify.get(
    '/brands/:id/strengths',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 3 } },
        },
        response: { 200: { type: 'array', items: CLUSTER_SCHEMA } },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { limit = 3 } = request.query as { limit?: number };
      const asOf = new Date();
      const items = await readScoredItems(request.user.tenantId, id, asOf);
      return topStrengths(clusterTopics(items, asOf), limit);
    },
  );

  /**
   * Headline counts for the dashboard stat row.
   *
   * One endpoint rather than four, because every figure comes from the same two tables and the
   * row is rendered together. `scoredCount` against `totalCount` is the pipeline's coverage —
   * the honest answer to "how much of what we ingested has actually been scored".
   */
  fastify.get(
    '/brands/:id/stats',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        response: {
          200: {
            type: 'object',
            properties: {
              signalsThisWeek: { type: 'integer' },
              signalsPreviousWeek: { type: 'integer' },
              totalSignals: { type: 'integer' },
              scoredSignals: { type: 'integer' },
              classifiedSignals: { type: 'integer' },
              lastRollupDate: { type: 'string', nullable: true },
              activeSources: { type: 'integer' },
              configuredSources: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const database = db.get();
      const now = Date.now();
      const weekAgo = new Date(now - 7 * MS_PER_DAY);
      const twoWeeksAgo = new Date(now - 14 * MS_PER_DAY);

      // Embed drizzle conditions rather than interpolating the Date values directly: a raw
      // `sql` fragment bypasses the timestamptz serialiser and sends
      // "Thu Jul 30 2026 … (British Summer Time)", which Postgres rejects. Same trap as the
      // keyset predicate in routes/signals.ts — see test/routes/keyset.test.ts.
      /* THE COVERAGE FUNNEL: collected → scored → classified → rolled up.

         Each step can silently drop a signal, and until this endpoint reported them the loss was
         invisible. `scoreAllDimensions` omits dimensions nothing touches, and the rollup skips a
         brand when that leaves it empty — so a signal scored with no dimensions is collected,
         paid for, scored, and then contributes to no index, no cluster and no drill-down, with
         nothing anywhere saying so. Two brands sat at zero rollup rows for weeks on exactly that
         path, and it was noticed by the owner rather than by the product.

         `attributedTo` for the same reason as `readScoredItems` above: this count is shown beside
         a score computed over mentions as well as the foreign key, and the two must agree. */
      const [counts] = await database
        .select({
          totalSignals: count(),
          thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${gte(signals.publishedAt, weekAgo)})`,
          previousWeek: sql<number>`COUNT(*) FILTER (WHERE ${and(gte(signals.publishedAt, twoWeeksAgo), lt(signals.publishedAt, weekAgo))})`,
          scored: sql<number>`COUNT(${sentimentResults.signalId})`,
          /* Scored AND tagged to at least one dimension. `cardinality(NULL)` is NULL, so a null
             array fails the filter — which is the wanted answer, not an accident. */
          classified: sql<number>`COUNT(*) FILTER (WHERE ${sentimentResults.signalId} IS NOT NULL AND cardinality(${sentimentResults.dimensions}) > 0)`,
        })
        .from(signals)
        .leftJoin(sentimentResults, eq(sentimentResults.signalId, signals.id))
        .where(attributedTo(id, request.user.tenantId));

      /* The last day the rollup produced anything for this brand. `null` here while
         `classifiedSignals` is non-zero is the precise signature of a brand falling out of the
         rollup, and it is the number that makes that visible on the day it happens. */
      const [rollup] = await database
        .select({ lastDate: max(dimensionScores.date) })
        .from(dimensionScores)
        .where(
          and(
            eq(dimensionScores.tenantId, request.user.tenantId),
            eq(dimensionScores.brandEntityId, id),
          ),
        );

      const [sources] = await database
        .select({
          configured: count(),
          active: sql<number>`COUNT(*) FILTER (WHERE ${sourceConfigs.isEnabled})`,
        })
        .from(sourceConfigs)
        .where(
          and(
            eq(sourceConfigs.tenantId, request.user.tenantId),
            eq(sourceConfigs.brandEntityId, id),
          ),
        );

      return {
        signalsThisWeek: Number(counts?.thisWeek ?? 0),
        signalsPreviousWeek: Number(counts?.previousWeek ?? 0),
        totalSignals: Number(counts?.totalSignals ?? 0),
        scoredSignals: Number(counts?.scored ?? 0),
        classifiedSignals: Number(counts?.classified ?? 0),
        lastRollupDate: rollup?.lastDate ?? null,
        activeSources: Number(sources?.active ?? 0),
        configuredSources: Number(sources?.configured ?? 0),
      };
    },
  );
};

/** Shared read for the cluster endpoints — same window the rollup uses. */
async function readScoredItems(
  tenantId: string,
  brandEntityId: string,
  asOf: Date,
): Promise<ScoredItem[]> {
  const since = new Date(asOf.getTime() - BRAND_IMPACT_LOOKBACK_DAYS * MS_PER_DAY);
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
    /* `attributedTo`, NOT `eq(signals.brandEntityId, …)`. The rollup that produces the score this
       endpoint explains has always counted mentions as well as the foreign key; this read path
       did not, so a product discussed in group-level coverage scored on the dashboard while its
       clusters and drill-down showed less. One predicate, imported by both. */
    .where(and(attributedTo(brandEntityId, tenantId), gte(signals.publishedAt, since)));

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

export default scoresRoutes;
