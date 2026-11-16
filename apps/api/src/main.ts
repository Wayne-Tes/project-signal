import type { FastifyInstance } from 'fastify';
import { getEnv } from '@project-signal/config';
import { buildApp } from './app.js';
import { runMigrations } from './migrate.js';

const start = async () => {
  let app: FastifyInstance | undefined;
  try {
    app = await buildApp({ logger: true });

    app.log.info('applying database migrations');
    await runMigrations();

    await app.listen({ port: getEnv().PORT, host: '0.0.0.0' });
  } catch (err) {
    // buildApp itself can fail (an invalid environment), before there is a logger to use.
    if (app) app.log.error(err);
    else console.error(err);
    process.exit(1);
  }
};

start();
