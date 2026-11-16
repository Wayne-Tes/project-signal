import Fastify, { type FastifyInstance } from 'fastify';

/**
 * The report worker's HTTP surface: health and readiness only, until reporting is built (Epic 12).
 *
 * Separate from main.ts so a test can build it without the boot sequence. When it lived in main.ts,
 * importing it ran `listen()` as a side effect — and on a machine where port 8083 was taken, the
 * test run hit `process.exit(1)` mid-suite.
 */
export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  app.get('/health', async () => ({ status: 'ok', service: 'report-worker' }));
  app.get('/ready', async () => ({ status: 'ok', service: 'report-worker' }));
  return app;
}
