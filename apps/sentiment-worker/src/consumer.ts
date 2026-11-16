import Fastify, { type FastifyInstance } from 'fastify';
import { SqsConsumer } from '@project-signal/messaging';
import { handleItemMessage, PermanentScoringError, type WorkerLog } from './handler.js';

/**
 * Reads a signal id out of an item-queue message body.
 *
 * Ingestion publishes the bare signal id. Tolerating a JSON envelope too costs one line and means
 * a future producer shape does not silently dead-letter every message. A body that is neither is
 * permanent — it will never parse — so this returns `undefined` rather than throwing.
 */
export function parseItemMessage(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return trimmed || undefined;
  try {
    const parsed = JSON.parse(trimmed) as { signalId?: unknown; id?: unknown };
    const id = parsed.signalId ?? parsed.id;
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The SQS consumer — how this service receives work.
 *
 * The worker used to also serve `POST /pubsub/item`, a survivor of the GCP design in which Pub/Sub
 * PUSHED to an endpoint. SQS pulls, so nothing ever called it on AWS; it was an unauthenticated
 * route that would score any signal id it was handed. Removed.
 */
export function createItemConsumer(log: WorkerLog): SqsConsumer {
  return new SqsConsumer({
    queue: 'item',
    handle: async (body) => {
      const signalId = parseItemMessage(body);
      if (!signalId) {
        /* Permanent: resolve so the consumer deletes it, rather than spending the redrive
           policy's retries reaching a conclusion known on the first attempt. */
        log.error({ body: body.slice(0, 160) }, 'message carried no signal id — discarding');
        return;
      }

      try {
        await handleItemMessage(signalId, log);
      } catch (err) {
        if (err instanceof PermanentScoringError) {
          /* Resolve rather than throw: the consumer deletes on success, and this message will
             never succeed. */
          log.error({ err, signalId }, 'permanent scoring failure — acking');
          return;
        }
        /* Anything else is transient. Throwing leaves the message undeleted, so it reappears
           after the visibility timeout and eventually reaches the DLQ. */
        throw err;
      }
    },
    onError: (err, body) => log.error({ err, body }, 'scoring message failed'),
  });
}

/** Health and readiness only — the work arrives on the queue. */
export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  app.get('/health', async () => ({ status: 'ok', service: 'sentiment-worker' }));
  app.get('/ready', async () => ({ status: 'ok', service: 'sentiment-worker' }));
  return app;
}
