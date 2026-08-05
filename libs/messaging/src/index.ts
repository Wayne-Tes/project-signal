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

export const TOPICS = {
  ITEM_QUEUE: 'project-signal-item-queue',
  ITEM_DLQ: 'project-signal-item-dlq',
  REPORT_QUEUE: 'project-signal-report-queue',
  REPORT_DLQ: 'project-signal-report-dlq',
} as const;
