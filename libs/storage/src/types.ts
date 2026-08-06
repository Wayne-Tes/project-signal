/**
 * Object storage for raw ingested payloads.
 *
 * Deliberately narrow: two methods, string in / string out. Everything the pipeline stores is
 * a JSON document, and keeping the surface this small is what lets the S3 implementation drop
 * in during the AWS migration without touching a caller.
 */
export interface ObjectStore {
  /** Stores `body` at `key` and returns the canonical reference to persist on the row. */
  put(key: string, body: string, contentType?: string): Promise<string>;
  /** Fetches the object previously stored at `key`. */
  get(key: string): Promise<string>;
}

/**
 * Builds the deterministic object key for a raw ingested item.
 *
 * `externalId` is percent-encoded because adapters derive it from source-supplied values that
 * can contain slashes (a URL, for instance). Without encoding, one item could write outside
 * its brand's prefix and the key depth would vary.
 */
export function rawKey(
  tenantId: string,
  brandId: string,
  source: string,
  externalId: string,
): string {
  return `${tenantId}/${brandId}/${source}/${encodeURIComponent(externalId)}.json`;
}

/**
 * Strips the `gs://bucket/` or `s3://bucket/` prefix from a stored reference, leaving the key.
 *
 * Rejects anything else — notably a bare URL, which is what `signals.raw_storage_ref` held
 * before raw storage was wired (KNOWN-GAPS #4). Failing loudly there beats silently treating a
 * source URL as an object key.
 */
export function keyFromRef(ref: string): string {
  const match = /^(?:gs|s3):\/\/[^/]+\/(.+)$/.exec(ref);
  if (!match?.[1]) throw new Error(`Unrecognised raw_storage_ref: ${ref}`);
  return match[1];
}
