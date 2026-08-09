import { and, eq } from 'drizzle-orm';
import { db, scanRuns, sourceConfigs } from '@project-signal/db';
import { SqsConsumer } from '@project-signal/messaging';
import { handleIngestionJob } from './handler.js';

/**
 * The scan consumer — the other half of the on-demand scan button.
 *
 * The API cannot call this service: ingestion has no ALB target group and no listener rule, so
 * nothing outside the VPC can reach it. It publishes to the `scan` queue instead, which is also
 * the right shape independently — a collection run blocks on third-party APIs for minutes, which
 * is not something to hold an HTTP request open for, and a queue gives retries for free.
 *
 * Every path through here ENDS THE RUN in a terminal state. A run left `queued` or `running`
 * forever is worse than one marked failed: the UI shows a spinner that never resolves, and the
 * debounce keeps refusing new scans because one is apparently still in flight.
 */

export interface ScanRequest {
  scanRunId: string;
  tenantId: string;
  brandEntityId: string;
}

/** Parses a queue message, or throws — a malformed body is permanent, not transient. */
export function parseScanRequest(body: string): ScanRequest {
  const parsed = JSON.parse(body) as Partial<ScanRequest>;
  if (!parsed.scanRunId || !parsed.tenantId || !parsed.brandEntityId) {
    throw new Error(`Scan message missing required fields: ${body.slice(0, 160)}`);
  }
  return parsed as ScanRequest;
}

/**
 * Runs every enabled source for one brand, recording progress on the run.
 *
 * Sources run through `allSettled`, not a loop that throws: one dead RSS feed must not prevent
 * the other four sources from collecting. A partially successful scan is still a useful scan,
 * and the counts tell the user exactly how partial it was.
 */
export async function runScan(request: ScanRequest): Promise<void> {
  const database = db.get();
  const { scanRunId, tenantId, brandEntityId } = request;

  const owned = and(eq(scanRuns.id, scanRunId), eq(scanRuns.tenantId, tenantId));

  await database.update(scanRuns).set({ status: 'running' }).where(owned);

  try {
    const configs = await database
      .select({ id: sourceConfigs.id })
      .from(sourceConfigs)
      .where(
        and(
          eq(sourceConfigs.tenantId, tenantId),
          eq(sourceConfigs.brandEntityId, brandEntityId),
          eq(sourceConfigs.isEnabled, true),
        ),
      );

    if (configs.length === 0) {
      /* Completed, not failed — nothing went wrong. But the message says why nothing happened,
         because "0 signals" with no explanation reads as a broken scan rather than as a brand
         with no sources configured. */
      await database
        .update(scanRuns)
        .set({
          status: 'completed',
          error: 'No enabled sources are configured for this brand.',
          finishedAt: new Date(),
        })
        .where(owned);
      return;
    }

    const results = await Promise.allSettled(configs.map((c) => handleIngestionJob(c.id)));

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const signals = results.reduce(
      (sum, r) => sum + (r.status === 'fulfilled' ? (r.value?.signalsCreated ?? 0) : 0),
      0,
    );
    const failures = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason instanceof Error ? r.reason.message : r.reason));

    await database
      .update(scanRuns)
      .set({
        /* Completed even when some sources failed. `failed` is reserved for "the scan itself did
           not run", so that a user can tell a broken feed apart from a broken product. */
        status: 'completed',
        sourcesAttempted: configs.length,
        sourcesSucceeded: succeeded,
        signalsCollected: signals,
        error: failures.length ? failures.slice(0, 3).join('; ') : null,
        finishedAt: new Date(),
      })
      .where(owned);
  } catch (err) {
    /* The scan itself failed — not one source within it. Recorded in words the user can act on,
       because a failed run reading only "failed" sends someone to logs they cannot reach. */
    await database
      .update(scanRuns)
      .set({
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        finishedAt: new Date(),
      })
      .where(owned);
    throw err;
  }
}

/** The consumer, wired to the scan queue. */
export function createScanConsumer(log: {
  info: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}): SqsConsumer {
  return new SqsConsumer({
    queue: 'scan',
    handle: async (body) => {
      let request: ScanRequest;
      try {
        request = parseScanRequest(body);
      } catch (err) {
        /* Permanent: the message will never parse. Resolve so the consumer deletes it rather
           than spending the redrive policy's retries on a conclusion known immediately. */
        log.error({ err, body }, 'unparseable scan message — discarding');
        return;
      }

      log.info({ scanRunId: request.scanRunId }, 'scan started');
      await runScan(request);
      log.info({ scanRunId: request.scanRunId }, 'scan finished');
    },
    onError: (err, body) => log.error({ err, body }, 'scan message failed'),
  });
}
