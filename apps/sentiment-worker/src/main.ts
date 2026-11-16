import { client } from '@project-signal/db';
import { buildApp, createItemConsumer } from './consumer.js';

/* Boot only. The queue handling lives in consumer.ts and handler.ts, both covered by tests; this
   file wires them to a real socket, database and queue. */

const app = buildApp();
const consumer = createItemConsumer(app.log);

const start = async () => {
  try {
    await client.get()`SELECT 1 AS ping`;
    app.log.info('DB ping OK');

    consumer.start();
    app.log.info('SQS consumer started on the item queue');

    await app.listen({ port: Number(process.env['PORT'] ?? 8082), host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

/* Stop polling before the process exits so an in-flight message is not abandoned mid-score.
   Anything already received but unfinished simply reappears after the visibility timeout. */
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    void (async () => {
      app.log.info(`${sig} received — stopping consumer`);
      await consumer.stop();
      await app.close();
      process.exit(0);
    })();
  });
}

void start();
