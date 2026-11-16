import { buildApp } from './app.js';

/* Boot only — the routes are in app.ts, which the tests cover. */

const app = buildApp();

const start = async () => {
  try {
    await app.listen({ port: Number(process.env['PORT'] ?? 8083), host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
