import Fastify, { type FastifyInstance } from 'fastify';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ status: 'ok', service: 'report-worker' }));
  app.get('/ready', async () => ({ status: 'ok', service: 'report-worker' }));
  return app;
}

const start = async () => {
  const app = await buildApp();
  try {
    await app.listen({ port: Number(process.env['PORT'] ?? 8083), host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
