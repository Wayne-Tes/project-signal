import type { FastifyPluginAsync } from 'fastify';
import { db, signals } from '@project-signal/db';
import { getObjectStore, keyFromRef } from '@project-signal/storage';
import { clampContent, joinTitleAndBody, stripHtml } from '@project-signal/source-adapters';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { requireRole } from '../plugins/auth.js';

/**
 * Recovering the readable text of signals collected before `signals.content` existed.
 *
 * WHY THIS IS A ROUTE AND NOT A SCRIPT. The database is not publicly accessible — by design; it
 * accepts connections only from the app security group. A local script cannot reach it, and
 * opening a path so one could would be a worse change than this endpoint. Running inside the API
 * means the task role already has S3 read and Postgres access, and the work happens where the
 * data lives.
 *
 * WHAT IT DOES. For every signal whose `content` is null, it reads the S3 object named by
 * `raw_storage_ref` — the untouched payload written at collection time — and populates `content`,
 * `title`, `author` and `rating` from it, applying exactly the same normalisation the adapters
 * now apply at ingestion. The S3 object is never modified.
 *
 * IDEMPOTENT AND RESUMABLE. It only ever selects rows with `content IS NULL`, so re-running it
 * costs one query and changes nothing. Batched, because a tenant with a hundred thousand signals
 * would otherwise hold one HTTP request open for an hour and time out at the load balancer with
 * the work half done and no record of how far it got.
 *
 * FAILURE IS PER ROW. An object that has been deleted, or a `raw_storage_ref` from before raw
 * storage was wired correctly (KNOWN-GAPS #4), must not abort the run for every other row. Those
 * are counted and reported, and the row keeps `content IS NULL` so a later run retries it.
 */

/** Rows per batch. Small enough that one HTTP request finishes well inside the ALB idle timeout. */
const DEFAULT_BATCH = 200;
const MAX_BATCH = 1000;

/** The shape the ingestion handler writes to S3. Every field is optional — old objects vary. */
interface RawPayload {
  text?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The author, whatever the adapter called it at the time.
 *
 * The alias list is the whole reason `signals.author` exists as a normalised column: `author`
 * (Reddit, App Store), `reviewerName` (Play Store, Google), `authorName` (YouTube). Historic S3
 * objects were written before that normalisation, so the aliases have to be understood HERE even
 * though new rows never need them again.
 */
function authorFrom(metadata: Record<string, unknown> | undefined): string | null {
  for (const key of ['author', 'reviewerName', 'authorName', 'username']) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
  }
  return null;
}

/** The rating, on whichever key the adapter used — `rating` or `stars`. */
function ratingFrom(metadata: Record<string, unknown> | undefined): number | null {
  for (const key of ['rating', 'stars']) {
    const value = Number(metadata?.[key]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return null;
}

function titleFrom(payload: RawPayload): string | null {
  const raw = payload.title ?? payload.metadata?.['title'] ?? payload.metadata?.['videoTitle'];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return stripHtml(raw) || null;
}

const backfillRoutes: FastifyPluginAsync = async (fastify) => {
  /** How much is left to do. Cheap, and the honest way to know whether a run is needed. */
  fastify.get(
    '/admin/backfill/content/status',
    {
      preHandler: requireRole('owner'),
      schema: {
        security: [{ BearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              withContent: { type: 'integer' },
              remaining: { type: 'integer' },
            },
          },
        },
      },
    },
    async () => {
      const [row] = await db
        .get()
        .select({
          total: sql<number>`COUNT(*)`,
          withContent: sql<number>`COUNT(*) FILTER (WHERE ${signals.content} IS NOT NULL)`,
        })
        .from(signals);

      const total = Number(row?.total ?? 0);
      const withContent = Number(row?.withContent ?? 0);
      return { total, withContent, remaining: total - withContent };
    },
  );

  fastify.post(
    '/admin/backfill/content',
    {
      preHandler: requireRole('owner'),
      schema: {
        security: [{ BearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            batch: { type: 'integer', minimum: 1, maximum: MAX_BATCH, default: DEFAULT_BATCH },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              examined: { type: 'integer' },
              updated: { type: 'integer' },
              failed: { type: 'integer' },
              remaining: { type: 'integer' },
              errors: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    async (request) => {
      const { batch = DEFAULT_BATCH } = request.query as { batch?: number };
      const database = db.get();
      const store = getObjectStore();

      const rows = await database
        .select({ id: signals.id, ref: signals.rawStorageRef })
        .from(signals)
        .where(isNull(signals.content))
        .limit(batch);

      let updated = 0;
      let failed = 0;
      /* A handful of distinct reasons, not one per row — a thousand copies of the same S3 error
         is noise, and the caller needs the shape of the failure, not its cardinality. */
      const errors = new Set<string>();

      for (const row of rows) {
        try {
          const payload = JSON.parse(await store.get(keyFromRef(row.ref))) as RawPayload;
          const title = titleFrom(payload);
          const body = stripHtml(String(payload.text ?? ''));
          const content = clampContent(joinTitleAndBody(title ?? undefined, body));

          if (!content) {
            /* An object with no text at all. Counted as a failure rather than written as an
               empty string: empty content would permanently exclude the row from every later
               run, hiding it instead of recording that it could not be recovered. */
            failed++;
            errors.add('payload contained no text');
            continue;
          }

          await database
            .update(signals)
            .set({
              content,
              title,
              author: authorFrom(payload.metadata),
              rating: ratingFrom(payload.metadata),
            })
            /* Re-checking `content IS NULL` makes concurrent runs safe: two overlapping calls
               cannot both claim the same row, and the second simply updates nothing. */
            .where(and(eq(signals.id, row.id), isNull(signals.content)));

          updated++;
        } catch (err) {
          failed++;
          errors.add(err instanceof Error ? err.message.slice(0, 200) : 'unknown error');
        }
      }

      const [remainingRow] = await database
        .select({ remaining: sql<number>`COUNT(*)` })
        .from(signals)
        .where(isNull(signals.content));

      request.log.info(
        { examined: rows.length, updated, failed },
        'signal content backfill batch complete',
      );

      return {
        examined: rows.length,
        updated,
        failed,
        remaining: Number(remainingRow?.remaining ?? 0),
        errors: [...errors].slice(0, 10),
      };
    },
  );
};

export default backfillRoutes;
