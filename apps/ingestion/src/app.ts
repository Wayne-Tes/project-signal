import Fastify, { type FastifyInstance } from 'fastify';
import { handleIngestionJob, reconcilePendingSignals } from './handler.js';
import { rollupDimensionScores } from './rollup.js';

/**
 * The ingestion service's HTTP surface.
 *
 * In a deployed environment NOTHING reaches these routes: ingestion has no ALB target group, and
 * every scheduled job (`scan-all`, `rollup`, `reconcile`) arrives on the scan queue instead — see
 * `scanConsumer.ts`. The routes stay because they are how a developer drives one step of the
 * pipeline by hand against the local stack (README, "Running the pipeline locally").
 *
 * `POST /ingest/dispatch` used to live here too. It ran EVERY enabled feed in the database at once
 * via `Promise.allSettled` — the opposite of the scheduled sweep, which scans brands one after
 * another precisely so a burst does not hit shared third-party quotas. Nothing called it, so it
 * was removed rather than left as a way to do the wrong thing.
 *
 * Built by a factory, separate from `main.ts`'s boot sequence, so the routes can be exercised
 * with `inject()` without opening a socket or a database connection.
 */
export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  app.get('/health', async () => ({ status: 'ok', service: 'ingestion' }));
  app.get('/ready', async () => ({ status: 'ok', service: 'ingestion' }));

  /** Collects one feed now. */
  app.post<{ Body: { sourceConfigId?: string } }>('/ingest', async (request, reply) => {
    const sourceConfigId = request.body?.sourceConfigId;
    if (!sourceConfigId) return reply.status(400).send({ error: 'sourceConfigId required' });
    const result = await handleIngestionJob(sourceConfigId);
    return reply.status(200).send({ status: 'ok', data: result });
  });

  /** The same sweep the hourly `reconcile` job runs. */
  app.post('/reconcile', async (_request, reply) => {
    const result = await reconcilePendingSignals();
    return reply.status(200).send({ status: 'ok', data: result });
  });

  /** The same rollup the hourly `rollup` job runs. */
  app.post('/rollup', async (_request, reply) => {
    const result = await rollupDimensionScores();
    return reply.status(200).send({ status: 'ok', data: result });
  });

  return app;
}
