import { client } from '@project-signal/db';
import Fastify from 'fastify';
import { SqsConsumer } from '@project-signal/messaging';
import { handlePubSubMessage, PermanentScoringError } from './handler.js';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok', service: 'sentiment-worker' }));
app.get('/ready', async () => ({ status: 'ok', service: 'sentiment-worker' }));

app.post(
  '/pubsub/item',
  {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: {
            type: 'object',
            required: ['data'],
            properties: {
              data: { type: 'string' },
            },
          },
          subscription: { type: 'string' },
        },
      },
    },
  },
  async (request, reply) => {
    const { message } = request.body as { message: { data: string }; subscription?: string };
    const signalId = Buffer.from(message.data, 'base64').toString('utf-8');

    try {
      await handlePubSubMessage(signalId);
    } catch (err) {
      if (err instanceof PermanentScoringError) {
        // Ack: retrying cannot help. Logged at error level so it is still visible.
        request.log.error({ err, signalId }, 'permanent scoring failure — acking');
        return reply.status(204).send();
      }
      // Nack: 500 tells Pub/Sub to redeliver. After max_delivery_attempts (5) the message
      // lands in the DLQ. Previously every failure returned 204, so the DLQ, the retry
      // backoff and max_delivery_attempts configured in Terraform could never fire at all
      // (KNOWN-GAPS #9) — a Gemini outage silently dropped every signal in the window.
      request.log.error({ err, signalId }, 'transient scoring failure — nacking for retry');
      return reply.status(500).send({ error: 'scoring failed', signalId });
    }

    return reply.status(204).send();
  },
);

/**
 * The SQS consumer — how this service actually receives work.
 *
 * The POST route above is a survivor of the GCP design, where Pub/Sub PUSHED to an endpoint. SQS
 * pulls, so nothing has ever called it in a deployed environment: ingestion published signal ids
 * and no process read them. Everything downstream of the queue — sentiment results, dimension
 * scores, Brand impact, the index itself — was therefore permanently empty on AWS.
 *
 * The route is kept because it is the only way to inject a single signal by hand when debugging,
 * and because deleting it is not this change's job. This is the path that runs.
 */
const consumer = new SqsConsumer({
  queue: 'item',
  handle: async (body) => {
    /* Ingestion publishes the bare signal id. Tolerating a JSON envelope too costs one line and
       means a future producer shape does not silently dead-letter every message. */
    let signalId = body.trim();
    if (signalId.startsWith('{')) {
      const parsed = JSON.parse(signalId) as { signalId?: string; id?: string };
      signalId = parsed.signalId ?? parsed.id ?? '';
    }
    if (!signalId) throw new Error(`Message carried no signal id: ${body.slice(0, 120)}`);

    try {
      await handlePubSubMessage(signalId);
    } catch (err) {
      if (err instanceof PermanentScoringError) {
        /* Resolve rather than throw: the consumer deletes on success, and this message will
           never succeed. Redelivering it until the redrive policy gives up spends a fixed number
           of retries to reach a conclusion already known on the first attempt. */
        app.log.error({ err, signalId }, 'permanent scoring failure — acking');
        return;
      }
      /* Anything else is transient. Throwing leaves the message undeleted, so it reappears after
         the visibility timeout and eventually reaches the DLQ that Terraform has always defined
         and that has never received anything. */
      throw err;
    }
  },
  onError: (err, body) => app.log.error({ err, body }, 'scoring message failed'),
});

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

start();
