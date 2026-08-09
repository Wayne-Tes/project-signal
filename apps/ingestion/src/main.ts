import { db, client, sourceConfigs } from '@project-signal/db';
import { queueUrl } from '@project-signal/messaging';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { handleIngestionJob, reconcilePendingSignals } from './handler.js';
import { rollupDimensionScores } from './rollup.js';
import { createScanConsumer } from './scanConsumer.js';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok', service: 'ingestion' }));
app.get('/ready', async () => ({ status: 'ok', service: 'ingestion' }));

app.post<{ Body: { sourceConfigId: string } }>('/ingest', async (request, reply) => {
  const { sourceConfigId } = request.body;
  if (!sourceConfigId) return reply.status(400).send({ error: 'sourceConfigId required' });
  const result = await handleIngestionJob(sourceConfigId);
  return reply.status(200).send({ status: 'ok', data: result });
});

app.post('/ingest/dispatch', async (_request, reply) => {
  const database = db.get();
  const enabled = await database
    .select({ id: sourceConfigs.id })
    .from(sourceConfigs)
    .where(eq(sourceConfigs.isEnabled, true));

  const results = await Promise.allSettled(enabled.map(({ id }) => handleIngestionJob(id)));
  return reply.status(200).send({
    status: 'ok',
    data: {
      total: enabled.length,
      succeeded: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    },
  });
});

// Hourly pending sweep (Cloud Scheduler). Re-publishes signals that were persisted but never
// scored — the safety net for a failed dual-write.
app.post('/reconcile', async (_request, reply) => {
  const result = await reconcilePendingSignals();
  return reply.status(200).send({ status: 'ok', data: result });
});

// Daily dimension rollups (Cloud Scheduler). Hosted here rather than in a new service because
// this app is already the private, scheduler-invoked home for batch work — see /reconcile.
app.post('/rollup', async (_request, reply) => {
  const result = await rollupDimensionScores();
  return reply.status(200).send({ status: 'ok', data: result });
});

/* On-demand scans arrive on the queue, because nothing can reach this service over HTTP: it has
   no ALB target group and no listener rule. */
const scanConsumer = createScanConsumer(app.log);

const start = async () => {
  try {
    await client.get()`SELECT 1 AS ping`;
    app.log.info('DB ping OK');

    // Resolve the queue URL at boot rather than at first publish. A missing ITEM_QUEUE_URL is a
    // misconfiguration, and this service exists to publish — better to refuse to start than to
    // accept a scheduler trigger and fail halfway through a fan-out.
    app.log.info({ itemQueue: queueUrl('item') }, 'SQS item queue resolved');

    scanConsumer.start();
    app.log.info('SQS consumer started on the scan queue');

    await app.listen({ port: Number(process.env['PORT'] ?? 8081), host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

/* Stop polling before exit so an in-flight scan is not abandoned half-way; an unfinished message
   simply reappears after the visibility timeout. */
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    void (async () => {
      app.log.info(`${sig} received — stopping scan consumer`);
      await scanConsumer.stop();
      await app.close();
      process.exit(0);
    })();
  });
}

start();
