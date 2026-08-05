import { db, client, sourceConfigs } from '@project-signal/db';
import { getPubSub } from '@project-signal/messaging';
import { getEnv } from '@project-signal/config';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { handleIngestionJob } from './handler.js';

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

const start = async () => {
  try {
    await client.get()`SELECT 1 AS ping`;
    app.log.info('DB ping OK');

    const pubsub = getPubSub();
    app.log.info({ projectId: getEnv().GOOGLE_CLOUD_PROJECT }, 'PubSub client initialized');
    void pubsub;

    await app.listen({ port: Number(process.env['PORT'] ?? 8081), host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
