import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db, scanRuns } from '@project-signal/db';
import { getPublisher } from '@project-signal/messaging';
import { requireBrandAccess, requireRole } from '../plugins/auth.js';

/**
 * On-demand scanning.
 *
 * The API does not call ingestion. It publishes a request to the `scan` queue and ingestion
 * consumes it. Two reasons, and the first is decisive: **ingestion has no ingress at all** — no
 * ALB target group, no listener rule, nothing outside the VPC can reach it. The second is that a
 * collection run blocks on third-party APIs for minutes, which is not something to hold an HTTP
 * request open for.
 *
 * `scan_runs` is what makes the button usable rather than a leap of faith. Collection is
 * asynchronous, takes minutes, and writes signals that will not reach a dashboard until a rollup
 * has also run — so without a status record the user presses Scan and observes nothing, forever.
 * That is the failure mode this codebase has hit repeatedly, and here it was predictable.
 */

/**
 * How long before the same brand may be scanned again.
 *
 * A scan hits third-party APIs with per-account quotas shared across every tenant, so the cost of
 * a user pressing the button eleven times is not theirs alone. Ten minutes is short enough that a
 * genuine retry after a failure is not obstructed, and long enough that impatience cannot burn a
 * daily quota.
 */
const DEBOUNCE_MINUTES = 10;

/** States a run can be in while it still counts as in-flight. */
const ACTIVE_STATUSES = ['queued', 'running'];

const RUN_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    brandEntityId: { type: 'string' },
    status: { type: 'string' },
    trigger: { type: 'string' },
    sourcesAttempted: { type: 'integer' },
    sourcesSucceeded: { type: 'integer' },
    signalsCollected: { type: 'integer' },
    error: { type: 'string', nullable: true },
    startedAt: { type: 'string' },
    finishedAt: { type: 'string', nullable: true },
  },
};

export const scanRoutes: FastifyPluginAsync = async (fastify) => {
  /** Recent runs for a brand — the status the UI polls. */
  fastify.get<{ Params: { id: string } }>(
    '/brands/:id/scans',
    {
      preHandler: requireBrandAccess,
      schema: {
        security: [{ BearerAuth: [] }],
        description: 'Recent scan runs for this brand, newest first.',
        params: { type: 'object', properties: { id: { type: 'string' } } },
        response: { 200: { type: 'array', items: RUN_SCHEMA } },
      },
    },
    async (request, reply) => {
      const rows = await db
        .get()
        .select()
        .from(scanRuns)
        .where(
          and(
            eq(scanRuns.tenantId, request.user.tenantId),
            eq(scanRuns.brandEntityId, request.params.id),
          ),
        )
        .orderBy(desc(scanRuns.startedAt))
        .limit(20);

      return reply.send(rows);
    },
  );

  /** Request a scan now. */
  fastify.post<{ Params: { id: string } }>(
    '/brands/:id/scan',
    {
      /* Both guards. `requireBrandAccess` stops a user scanning a brand that is not theirs;
         `requireRole` stops a plain viewer spending the tenant's third-party quota at all. */
      preHandler: [requireBrandAccess, requireRole('admin', 'owner')],
      schema: {
        security: [{ BearerAuth: [] }],
        description:
          'Queue a collection run for this brand. Returns the run record; poll /brands/:id/scans for progress.',
        params: { type: 'object', properties: { id: { type: 'string' } } },
        response: { 202: RUN_SCHEMA },
      },
    },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const brandEntityId = request.params.id;

      /* Debounce. Checked before anything is written, so a double-click cannot create two runs
         and two queue messages. This is a read-then-write and therefore racy under genuinely
         simultaneous requests; the cost of losing that race is one duplicate collection, which
         is why it is not worth a lock. A unique partial index would be the fix if it ever
         matters. */
      const since = new Date(Date.now() - DEBOUNCE_MINUTES * 60_000);
      const [recent] = await db
        .get()
        .select({ id: scanRuns.id, status: scanRuns.status, startedAt: scanRuns.startedAt })
        .from(scanRuns)
        .where(
          and(
            eq(scanRuns.tenantId, tenantId),
            eq(scanRuns.brandEntityId, brandEntityId),
            inArray(scanRuns.status, ACTIVE_STATUSES),
            gte(scanRuns.startedAt, since),
          ),
        )
        .orderBy(desc(scanRuns.startedAt))
        .limit(1);

      if (recent) {
        /* 409, not 429: this is not rate limiting, it is "that already exists and is running".
           The existing run is returned so the UI can show its progress rather than an error. */
        return reply.code(409).send({
          status: 'error',
          error: 'A scan is already in progress for this brand.',
          run: recent,
        });
      }

      const [run] = await db
        .get()
        .insert(scanRuns)
        .values({
          tenantId,
          brandEntityId,
          status: 'queued',
          trigger: 'manual',
          requestedBy: request.user.uid,
        })
        .returning();

      if (!run) return reply.internalServerError('Could not record the scan run.');

      try {
        await getPublisher().publish(
          'scan',
          JSON.stringify({ scanRunId: run.id, tenantId, brandEntityId }),
        );
      } catch (err) {
        /* The row exists but nothing will ever process it, so it is marked failed immediately
           rather than left `queued` forever. A run stuck in "queued" with no consumer is exactly
           the silent-failure shape this table was added to prevent. */
        request.log.error({ err, scanRunId: run.id }, 'could not queue scan');
        await db
          .get()
          .update(scanRuns)
          .set({
            status: 'failed',
            error: 'Could not queue the scan request.',
            finishedAt: new Date(),
          })
          .where(and(eq(scanRuns.id, run.id), eq(scanRuns.tenantId, tenantId)));

        return reply.serviceUnavailable('Could not queue the scan request.');
      }

      /* 202: accepted, not done. The work has not happened yet and the response must not imply
         otherwise. */
      return reply.code(202).send(run);
    },
  );
};

export default scanRoutes;
