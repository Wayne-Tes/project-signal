import { client } from '@project-signal/db';
import { queueUrl } from '@project-signal/messaging';
import { buildApp } from './app.js';
import { createScanConsumer } from './scanConsumer.js';

/* Boot only. The routes live in app.ts and the queue handling in scanConsumer.ts, both covered by
   tests; this file wires them to a real socket, a real database and a real queue. */

const app = buildApp();

/* On-demand scans and every scheduled job arrive on the queue, because nothing can reach this
   service over HTTP in a deployed environment: it has no ALB target group and no listener rule. */
const scanConsumer = createScanConsumer(app.log);

const start = async () => {
  try {
    await client.get()`SELECT 1 AS ping`;
    app.log.info('DB ping OK');

    // Resolve the queue URL at boot rather than at first publish. A missing ITEM_QUEUE_URL is a
    // misconfiguration, and this service exists to publish — better to refuse to start than to
    // accept a job and fail halfway through it.
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

void start();
