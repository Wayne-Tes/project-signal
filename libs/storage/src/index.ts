import { getEnv } from '@project-signal/config';
import { GcsObjectStore } from './gcs.js';
import type { ObjectStore } from './types.js';

export type { ObjectStore } from './types.js';
export { rawKey, keyFromRef } from './types.js';
export { GcsObjectStore } from './gcs.js';

let _store: ObjectStore | undefined;

/**
 * Returns the process-wide object store, memoised.
 *
 * Only GCS exists today. The AWS migration adds an S3 branch selected by `CLOUD_PROVIDER`
 * (see docs/superpowers/plans/2026-08-06-aws-migration.md); the interface exists now so that
 * change touches this file alone.
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
    _store = new GcsObjectStore(RAW_BUCKET);
  }
  return _store;
}

/** Test seam: drops the memoised instance so a later call re-reads the environment. */
export function resetObjectStore(): void {
  _store = undefined;
}
