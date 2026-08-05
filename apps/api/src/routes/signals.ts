import type { FastifyPluginAsync } from 'fastify';
import { db, signals, sentimentResults, dimensionScores } from '@project-signal/db';
import { and, eq, gt, count, avg, sql } from 'drizzle-orm';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const SENTIMENT_PERIOD_DAYS = 30;

const signalsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/brands/:id/signals', {
    schema: {
      security: [{ BearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
          cursor: { type: 'string' },
          source: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'object' } },
            nextCursor: { type: 'string', nullable: true },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit = DEFAULT_LIMIT, cursor, source } = request.query as {
      limit?: number;
      cursor?: string;
      source?: string;
    };

    const filters = [
      eq(signals.tenantId, request.user.tenantId),
      eq(signals.brandEntityId, id),
    ];
    if (cursor) filters.push(gt(signals.id, cursor));
    if (source) filters.push(eq(signals.source, source));

    const rows = await db.get().select().from(signals)
      .where(and(...filters))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return reply.send({ items, nextCursor });
  });

  fastify.get('/brands/:id/sentiment-summary', {
    schema: {
      security: [{ BearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            totalCount: { type: 'integer' },
            positiveCount: { type: 'integer' },
            negativeCount: { type: 'integer' },
            neutralCount: { type: 'integer' },
            mixedCount: { type: 'integer' },
            avgScore: { type: 'number', nullable: true },
            period: { type: 'string' },
          },
        },
      },
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const since = new Date(Date.now() - SENTIMENT_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const rows = await db.get()
      .select({
        totalCount: count(),
        avgScore: avg(sentimentResults.score),
        positiveCount: sql<number>`COUNT(*) FILTER (WHERE ${sentimentResults.label} = 'positive')`,
        negativeCount: sql<number>`COUNT(*) FILTER (WHERE ${sentimentResults.label} = 'negative')`,
        neutralCount: sql<number>`COUNT(*) FILTER (WHERE ${sentimentResults.label} = 'neutral')`,
        mixedCount: sql<number>`COUNT(*) FILTER (WHERE ${sentimentResults.label} = 'mixed')`,
      })
      .from(signals)
      .innerJoin(sentimentResults, eq(sentimentResults.signalId, signals.id))
      .where(and(
        eq(signals.tenantId, request.user.tenantId),
        eq(signals.brandEntityId, id),
        gt(signals.publishedAt, since),
      ));

    const row = rows[0];
    return {
      totalCount: Number(row?.totalCount ?? 0),
      positiveCount: Number(row?.positiveCount ?? 0),
      negativeCount: Number(row?.negativeCount ?? 0),
      neutralCount: Number(row?.neutralCount ?? 0),
      mixedCount: Number(row?.mixedCount ?? 0),
      avgScore: row?.avgScore != null ? Number(row.avgScore) : null,
      period: `${SENTIMENT_PERIOD_DAYS}d`,
    };
  });

  fastify.get('/brands/:id/dimension-scores', {
    schema: {
      security: [{ BearerAuth: [] }],
      params: { type: 'object', properties: { id: { type: 'string' } } },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dimension: { type: 'string' },
              score: { type: 'number' },
              date: { type: 'string' },
              signalCount: { type: 'integer' },
            },
          },
        },
      },
    },
  }, async (request) => {
    const { id } = request.params as { id: string };

    return db.get().select({
      dimension: dimensionScores.dimension,
      score: dimensionScores.score,
      date: dimensionScores.date,
      signalCount: dimensionScores.signalCount,
    }).from(dimensionScores).where(
      and(
        eq(dimensionScores.tenantId, request.user.tenantId),
        eq(dimensionScores.brandEntityId, id),
      ),
    );
  });
};

export default signalsRoutes;
