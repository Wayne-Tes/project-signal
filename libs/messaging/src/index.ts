import { SqsPublisher } from './sqs.js';
import type { MessagePublisher } from './types.js';

export type { LogicalQueue, MessagePublisher } from './types.js';
export { SqsPublisher, queueUrl } from './sqs.js';

let _publisher: MessagePublisher | undefined;

/**
 * Returns the process-wide publisher, memoised.
 *
 * As with `getObjectStore()`, there is no `CLOUD_PROVIDER` switch: GCP was abandoned before it
 * was ever provisioned, so the Pub/Sub implementation was deleted rather than parked behind a
 * branch nobody would exercise. The interface is what carries the design value.
 */
export function getPublisher(): MessagePublisher {
  if (!_publisher) {
    _publisher = new SqsPublisher();
  }
  return _publisher;
}

/** Test seam: drops the memoised instance so a later call re-reads the environment. */
export function resetPublisher(): void {
  _publisher = undefined;
}

export { SqsConsumer, type ConsumerOptions } from './consumer.js';
