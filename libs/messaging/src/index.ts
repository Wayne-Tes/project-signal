import { PubSub } from '@google-cloud/pubsub';
import { getEnv } from '@project-signal/config';

let _pubsub: PubSub;

export function getPubSub(): PubSub {
  if (!_pubsub) {
    const env = getEnv();
    // When PUBSUB_EMULATOR_HOST is set, the client connects to the local emulator.
    _pubsub = new PubSub({ projectId: env.GOOGLE_CLOUD_PROJECT });
  }
  return _pubsub;
}

/**
 * Local-development topic names, used by the Pub/Sub emulator.
 *
 * These are NOT the deployed names. Terraform creates `<environment>-item` / `<environment>-report`
 * and injects them as `ITEM_TOPIC` / `REPORT_TOPIC`. Always resolve through `topicName()` —
 * publishing to these constants in a deployed environment targets a topic that does not exist.
 */
export const TOPICS = {
  ITEM_QUEUE: 'project-signal-item-queue',
  ITEM_DLQ: 'project-signal-item-dlq',
  REPORT_QUEUE: 'project-signal-report-queue',
  REPORT_DLQ: 'project-signal-report-dlq',
} as const;

export type LogicalTopic = 'item' | 'report';

/**
 * Resolves a logical topic to its concrete name for the current environment.
 *
 * Reads `ITEM_TOPIC` / `REPORT_TOPIC` — set by Terraform per environment — and falls back to
 * the local-dev constants when unset. An empty string is treated as unset: an env var that is
 * present but blank must not become the topic name.
 */
export function topicName(logical: LogicalTopic): string {
  const env = getEnv();
  if (logical === 'item') return env.ITEM_TOPIC || TOPICS.ITEM_QUEUE;
  return env.REPORT_TOPIC || TOPICS.REPORT_QUEUE;
}
