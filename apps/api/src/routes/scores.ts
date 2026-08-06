import type { FastifyPluginAsync } from 'fastify';
import { db, brandEntities, dimensionScores, signals, sentimentResults } from '@project-signal/db';
import {
  achillesHeels,
  clusterTopics,
  compositeScore,
  HALF_LIFE_DAYS,
  parseWeights,
  type DimensionRollup,
  type ScoredItem,
} from '@project-signal/scoring';
import type { Dimension, SentimentLabel } from '@project-signal/shared-types';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { requireBrandAccess } from '../plugins/auth.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default history window for the trend endpoints. */
const DEFAULT_HISTORY_DAYS = 90;

/** How far back a delta looks for a comparison point — the dashboard reports week-on-week. */
const COMPARISON_DAYS = 7;

/** Items older than four half-lives carry under 1/16th weight; reading further is waste. */
const ACHILLES_LOOKBACK_DAYS = HALF_LIFE_DAYS * 4;

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
        return { score: null, previousScore: null, date: null, previousDate: null, dimensions: [] };
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
      };
    },
  );

  /**
   * Achilles Heel: the topic clusters doing the most damage.
   *
   * Computed on read rather than persisted. Clusters have no table, and deriving them from
   * `sentiment_results` keeps the topic taxonomy free to change without a migration — the model
   * invents topic tags per signal, so a stored cluster would be stale the moment tagging
   * shifted. Bounded by the same four-half-life lookback the rollup uses.
   */
  fastify.get(
    '/brands/:id/achilles',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        params: { type: 'object', properties: { id: { type: 'string' } } },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 20, default: 3 } },
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                topic: { type: 'string' },
                volume: { type: 'integer' },
                negativity: { type: 'number' },
                recency: { type: 'number' },
                damage: { type: 'number' },
                sentiment: { type: 'number' },
                dimensions: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { limit = 3 } = request.query as { limit?: number };
      const asOf = new Date();
      const since = new Date(asOf.getTime() - ACHILLES_LOOKBACK_DAYS * MS_PER_DAY);

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
            eq(signals.tenantId, request.user.tenantId),
            eq(signals.brandEntityId, id),
            gte(signals.publishedAt, since),
          ),
        );

      const items: ScoredItem[] = rows.map((r) => ({
        signalId: r.signalId,
        publishedAt: r.publishedAt,
        score: r.score ?? 0,
        confidence: r.confidence ?? 0,
        label: (r.label ?? 'neutral') as SentimentLabel,
        dimensions: (r.dimensions ?? []) as Dimension[],
        topics: r.topics ?? [],
      }));

      return achillesHeels(clusterTopics(items, asOf), limit);
    },
  );
};

export default scoresRoutes;
