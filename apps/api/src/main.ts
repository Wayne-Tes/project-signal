import type { FastifyInstance } from 'fastify';
import { getEnv, listenHost } from '@project-signal/config';
import { buildApp } from './app.js';
import { runMigrations } from './migrate.js';

const start = async () => {
  let app: FastifyInstance | undefined;
  try {
    app = await buildApp({ logger: true });

    app.log.info('applying database migrations');
    await runMigrations();

    await app.listen({ port: getEnv().PORT, host: listenHost() });
  } catch (err) {
    // buildApp itself can fail (an invalid environment), before there is a logger to use.
    if (app) app.log.error(err);
    else console.error(err);
    process.exit(1);
  }
};

// start() handles every failure itself (logs, exits 1); `void` marks that as deliberate.
void start();
