import type { FastifyPluginAsync } from 'fastify';
import { attributedTo, db, signals, sentimentResults, territoryFilter } from '@project-signal/db';
import { and, desc, eq, gt, lt, or, count, avg, sql, type SQL } from 'drizzle-orm';
import { DIMENSIONS } from '@project-signal/scoring';
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
    /* WHICH feed produced it. `source` says "rss"; with six RSS feeds on one brand that
       identifies nothing, and a report citing evidence has to be able to say where it came from.
       Null for anything collected before feeds were tracked individually. */
    sourceConfigId: { type: 'string', nullable: true },
    sourceUrl: { type: 'string' },
    rawStorageRef: { type: 'string' },
    publishedAt: { type: 'string' },
    ingestedAt: { type: 'string' },
    /* THE READABLE EVIDENCE. Without these the drill-down could only show a source name, a date
       and a link out — so every piece of evidence meant leaving the app, correlating by hand, and
       returning to a closed drawer. `sourceUrl` is still returned and still rendered: the link to
       the original is an addition to the text, never a substitute for it. */
    content: { type: 'string', nullable: true },
    title: { type: 'string', nullable: true },
    author: { type: 'string', nullable: true },
    rating: { type: 'integer', nullable: true },
    /* The scorer's verdict on THIS signal, joined from `sentiment_results`. The audience is a
       marketing manager, not an engineer: showing a quotation without saying whether the model
       read it as positive or negative — and on which dimension — leaves them to infer the
       system's reasoning from prose, which is the guessing game this is meant to end. */
    sentiment: {
      type: 'object',
      nullable: true,
      properties: {
        label: { type: 'string' },
        score: { type: 'number' },
        confidence: { type: 'number' },
        dimensions: { type: 'array', items: { type: 'string' } },
        topics: { type: 'array', items: { type: 'string' } },
      },
    },
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

/**
 * Signals carrying a given topic.
 *
 * EXISTS against the scored row rather than a join: a join multiplies the signal row by its
 * topics, which silently breaks both the page size and the keyset cursor — both assume one row
 * per signal.
 *
 * The topic is a BOUND PARAMETER. It arrives from a URL and, through the assistant's tools, can
 * be chosen by a language model; `= ANY(topics)` keeps it a value rather than SQL text in every
 * case. Exported so a test can render it through the real dialect — see keyset.test.ts for why
 * that is not optional in this file.
 */
export function topicFilter(topic: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${sentimentResults}
    WHERE ${sentimentResults.signalId} = ${signals.id}
      AND ${topic} = ANY(${sentimentResults.topics})
  )`;
}

/**
 * Signals the scorer tagged with a given dimension.
 *
 * The same EXISTS construction as `topicFilter`, and for the same reason: `dimensions` is a
 * `text[]` on the scored row, and joining to it would multiply the signal row by its dimensions,
 * breaking the page size and the keyset cursor.
 *
 * This is what lets the drill-down keep its promise. Level 1 reads
 * `dimension_scores.signal_count` and says "5 signals contributed"; before this filter existed
 * there was no way to ASK for those five, so a dimension with no damaging topic cluster
 * dead-ended on a message telling the user nothing had been tagged to it.
 *
 * The dimension is a BOUND PARAMETER. It arrives from a URL and, through the assistant's tools,
 * can be chosen by a language model.
 */
export function dimensionFilter(dimension: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${sentimentResults}
    WHERE ${sentimentResults.signalId} = ${signals.id}
      AND ${dimension} = ANY(${sentimentResults.dimensions})
  )`;
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
            territory: {
              type: 'string',
              description:
                "Restrict to signals collected from one territory. Omit, or pass 'all', for every territory.",
            },
            sourceConfigId: {
              type: 'string',
              description:
                'Return only signals from one configured feed. `source` filters by TYPE, which no longer identifies a single feed.',
            },
            topic: {
              type: 'string',
              description:
                'Return only signals the scorer tagged with this topic. This is how the drill-down shows the evidence behind a Brand impact cluster.',
            },
            dimension: {
              type: 'string',
              enum: [...DIMENSIONS],
              description:
                'Return only signals the scorer tagged with this dimension — the evidence behind a dimension score, whether or not any topic cluster has formed.',
            },
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
        sourceConfigId,
        topic,
        dimension,
        territory,
      } = request.query as {
        limit?: number;
        cursor?: string;
        source?: string;
        territory?: string;
        sourceConfigId?: string;
        topic?: string;
        dimension?: string;
      };

      /* `attributedTo` covers the tenant filter AND both attribution mechanisms. Filtering on the
         foreign key alone made this list a strict subset of the signals the score above it was
         computed from — an article about the group naming this product counted toward its index
         and then did not appear as evidence for it. */
      const filters = [attributedTo(id, request.user.tenantId)];
      /*  returns undefined for 'no filter', which and() drops — so this reads
         the same whether or not a territory was asked for. */
      const byTerritory = territoryFilter(territory);
      if (byTerritory) filters.push(byTerritory);
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
      /* Narrower than `source`, and both may be applied. This is what lets a finding be
         attributed to "Google News — Tes MyConcern" rather than to "rss". */
      if (sourceConfigId) filters.push(eq(signals.sourceConfigId, sourceConfigId));

      /* Topic filter — the evidence behind a Brand impact cluster.
     
         Topics live on `sentiment_results.topics`, a text[], so this is an EXISTS against the
         scored row rather than a join: a join would multiply the signal row by its topics and
         silently break both the page size and the keyset cursor, which assume one row per
         signal.
     
         The topic is passed as a BOUND PARAMETER inside the array literal rather than
         interpolated. It arrives from a URL and, through the assistant, can be chosen by a
         model; `= ANY(topics)` keeps it a value in every case. */
      if (topic) filters.push(topicFilter(topic));

      /* Dimension filter — the evidence behind a dimension SCORE, which is a different question
         from the evidence behind a topic. A dimension always has contributing signals if its
         score exists; it does not always have a topic cluster. Both may be applied. */
      if (dimension) filters.push(dimensionFilter(dimension));

      /* LEFT join, and safe for the cursor: `sentiment_results.signal_id` is UNIQUE, so this
         cannot multiply a signal into several rows the way joining `topics` or `dimensions`
         would. Left rather than inner because an unscored signal is still evidence — it must
         appear, with its sentiment reported as absent rather than being silently dropped. */
      const rows = await db
        .get()
        .select({
          id: signals.id,
          tenantId: signals.tenantId,
          brandEntityId: signals.brandEntityId,
          source: signals.source,
          sourceConfigId: signals.sourceConfigId,
          sourceUrl: signals.sourceUrl,
          rawStorageRef: signals.rawStorageRef,
          content: signals.content,
          title: signals.title,
          author: signals.author,
          rating: signals.rating,
          publishedAt: signals.publishedAt,
          ingestedAt: signals.ingestedAt,
          label: sentimentResults.label,
          score: sentimentResults.score,
          confidence: sentimentResults.confidence,
          dimensions: sentimentResults.dimensions,
          topics: sentimentResults.topics,
        })
        .from(signals)
        .leftJoin(sentimentResults, eq(sentimentResults.signalId, signals.id))
        .where(and(...filters))
        .orderBy(desc(signals.publishedAt), desc(signals.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor = hasMore && last ? encodeCursor(last.publishedAt, last.id) : null;

      /* Nested rather than flattened, so "the signal" and "what the model concluded about it"
         stay distinguishable. A null `sentiment` means not yet scored — which the UI renders
         differently from a neutral score, because they are different facts. */
      const items = page.map(({ label, score, confidence, dimensions, topics, ...signal }) => ({
        ...signal,
        sentiment: label
          ? {
              label,
              score: score ?? 0,
              confidence: confidence ?? 0,
              dimensions: dimensions ?? [],
              topics: topics ?? [],
            }
          : null,
      }));

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
        .where(and(attributedTo(id, request.user.tenantId), gt(signals.publishedAt, since)));

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
};

export default signalsRoutes;
