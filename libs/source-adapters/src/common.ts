import type { Signal, SignalSource } from '@project-signal/shared-types';
import type { AdapterConfig, RawItem } from './index.js';

/**
 * The signal row an adapter contributes.
 *
 * Every adapter had an identical copy of this. One definition means a field added to the row is
 * added for every source at once, instead of for whichever five of six someone remembered.
 */
export function baseSignal(
  source: SignalSource,
  item: RawItem,
  config: AdapterConfig,
): Omit<Signal, 'id' | 'ingestedAt' | 'rawStorageRef'> {
  return {
    tenantId: config.tenantId,
    brandEntityId: config.brandEntityId,
    source,
    sourceUrl: item.url,
    publishedAt: item.publishedAt,
  };
}

/** XML parsers return a lone child as an object and several as an array. Always an array. */
export function toArray<T>(value: unknown): T[] {
  if (!value) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

/**
 * Whether an item is worth storing as a signal.
 *
 * An item with no text can never be scored — the worker refuses it permanently — and one with no
 * external id collides with every other id-less item on the storage key. Both used to be stored
 * from Google reviews and YouTube, as signals that existed only to fail.
 */
export function isUsable(item: RawItem): boolean {
  return item.text.trim().length > 0 && item.externalId.trim().length > 0;
}

/** Keeps only items published strictly after the watermark, when there is one. */
export function newerThan(items: RawItem[], since: Date | undefined): RawItem[] {
  return since ? items.filter((item) => item.publishedAt > since) : items;
}
