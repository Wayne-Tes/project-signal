import { client } from '@project-signal/db';
import { getPubSub } from '@project-signal/messaging';
import { getEnv } from '@project-signal/config';
import Fastify from 'fastify';
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

const start = async () => {
  try {
    await client.get()`SELECT 1 AS ping`;
    app.log.info('DB ping OK');

    const pubsub = getPubSub();
    app.log.info({ projectId: getEnv().GOOGLE_CLOUD_PROJECT }, 'PubSub client initialized');
    void pubsub;

    await app.listen({ port: Number(process.env['PORT'] ?? 8082), host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
