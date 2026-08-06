import type { FastifyPluginAsync } from 'fastify';
import { db, signals, sentimentResults, dimensionScores } from '@project-signal/db';
import { and, desc, eq, gt, lt, or, count, avg, sql, type SQL } from 'drizzle-orm';
import { requireBrandAccess } from '../plugins/auth.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const SENTIMENT_PERIOD_DAYS = 30;

/**
 * Response shape for a signal row.
 *
 * Fastify serialises through fast-json-stringify, which strips every property the schema does
 * not declare. This was previously `{ type: 'object' }` with no properties, so the endpoint
 * returned `items: [{}, {}]` — every field silently removed. Declaring the columns is what
 * makes the payload non-empty, so keep this in sync with `libs/db/src/schema/signals.ts`.
 *
 * The denormalised `sentiment_*` / `model_version` columns are deliberately omitted: nothing
 * writes them (KNOWN-GAPS #11) and exposing them here would tacitly adopt them before that
 * decision is made. Sentiment is read from `sentiment_results` via the summary endpoint.
 */
const SIGNAL_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    brandEntityId: { type: 'string' },
    source: { type: 'string' },
    sourceUrl: { type: 'string' },
    rawStorageRef: { type: 'string' },
    publishedAt: { type: 'string' },
    ingestedAt: { type: 'string' },
  },
};

/**
 * Keyset cursor over the `(published_at, id)` ordering.
 *
 * Both columns are encoded because neither is a stable sort key alone: `published_at` is not
 * unique, and `signals.id` is a random UUID that carries no sequence. Paginating on the UUID
 * alone — with no ORDER BY at all, as this route previously did — let Postgres return rows in
 * any order, so pages could repeat rows, skip rows, or end early.
 */
function encodeCursor(publishedAt: Date, id: string): string {
  return Buffer.from(`${publishedAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { publishedAt: Date; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  if (sep === -1) throw new Error('Malformed cursor');

  const publishedAt = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (Number.isNaN(publishedAt.getTime()) || !id) throw new Error('Malformed cursor');

  return { publishedAt, id };
}

/**
 * Keyset predicate for `ORDER BY published_at DESC, id DESC`.
 *
 * Expressed with drizzle's typed operators rather than a raw `sql` row-value comparison
 * (`(published_at, id) < ($1, $2)`). That form is the textbook keyset idiom and is valid
 * Postgres, but interpolating a JS `Date` into a raw `sql` fragment bypasses drizzle's
 * timestamptz serialiser: the Date arrives as `Thu Jan 01 2026 04:00:00 GMT+0000 (Greenwich
 * Mean Time)` and the query fails at runtime. Typed column operators serialise correctly.
 */
export function keysetBefore(publishedAt: Date, id: string): SQL | undefined {
  return or(
    lt(signals.publishedAt, publishedAt),
    and(eq(signals.publishedAt, publishedAt), lt(signals.id, id)),
  );
}

const signalsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/brands/:id/signals',
    {
      preHandler: requireBrandAccess,
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
              items: { type: 'array', items: SIGNAL_SCHEMA },
              nextCursor: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const {
        limit = DEFAULT_LIMIT,
        cursor,
        source,
      } = request.query as {
        limit?: number;
        cursor?: string;
        source?: string;
      };

      const filters = [eq(signals.tenantId, request.user.tenantId), eq(signals.brandEntityId, id)];
      if (cursor) {
        let decoded: { publishedAt: Date; id: string };
        try {
          decoded = decodeCursor(cursor);
        } catch {
          return reply.badRequest('Malformed cursor');
        }
        const keyset = keysetBefore(decoded.publishedAt, decoded.id);
        if (keyset) filters.push(keyset);
      }
      if (source) filters.push(eq(signals.source, source));

      const rows = await db
        .get()
        .select()
        .from(signals)
        .where(and(...filters))
        .orderBy(desc(signals.publishedAt), desc(signals.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.publishedAt, last.id) : null;

      return reply.send({ items, nextCursor });
    },
  );

  fastify.get(
    '/brands/:id/sentiment-summary',
    {
      preHandler: requireBrandAccess,
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
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const since = new Date(Date.now() - SENTIMENT_PERIOD_DAYS * 24 * 60 * 60 * 1000);

      const rows = await db
        .get()
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
        .where(
          and(
            eq(signals.tenantId, request.user.tenantId),
            eq(signals.brandEntityId, id),
            gt(signals.publishedAt, since),
          ),
        );

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
    },
  );

  fastify.get(
    '/brands/:id/dimension-scores',
    {
      preHandler: requireBrandAccess,
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
    },
    async (request) => {
      const { id } = request.params as { id: string };

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
          ),
        );
    },
  );
};

export default signalsRoutes;
