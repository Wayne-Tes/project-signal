import { getEnv } from '@project-signal/config';
import { S3ObjectStore } from './s3.js';
import type { ObjectStore } from './types.js';

export type { ObjectStore } from './types.js';
export { rawKey, keyFromRef } from './types.js';
export { S3ObjectStore } from './s3.js';

let _store: ObjectStore | undefined;

/**
 * Returns the process-wide object store, memoised.
 *
 * There is deliberately no `CLOUD_PROVIDER` switch. GCP was never provisioned and has been
 * abandoned (see docs/HANDOVER.md), so a factory with one live branch would be dead code that
 * still had to clear the 80% coverage gate. The `ObjectStore` interface is kept — it has real
 * design value and it is what made swapping the implementation a single-file change — but the
 * GCS implementation is gone rather than parked.
 */
export function getObjectStore(): ObjectStore {
  if (!_store) {
    const { RAW_BUCKET } = getEnv();
    if (!RAW_BUCKET) {
      throw new Error(
        'RAW_BUCKET must be set to use the object store. Terraform injects it into the ' +
          'ingestion and sentiment-worker services; set it in .env for local development.',
      );
    }
    _store = new S3ObjectStore(RAW_BUCKET);
  }
  return _store;
}

/** Test seam: drops the memoised instance so a later call re-reads the environment. */
export function resetObjectStore(): void {
  _store = undefined;
}
