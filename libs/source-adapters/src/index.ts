import type { Signal, SignalSource } from '@project-signal/shared-types';

export interface AdapterConfig {
  brandEntityId: string;
  tenantId: string;
  source: SignalSource;
  credentials?: Record<string, string>;
}

export interface FetchResult {
  items: RawItem[];
  cursor?: string;
}

export interface RawItem {
  externalId: string;
  url: string;
  text: string;
  publishedAt: Date;
  metadata: Record<string, unknown>;
}

export interface SourceAdapter {
  readonly source: SignalSource;
  fetch(config: AdapterConfig, since?: Date): Promise<FetchResult>;
  toSignal(
    item: RawItem,
    config: AdapterConfig,
  ): Omit<Signal, 'id' | 'ingestedAt' | 'rawStorageRef'>;
}

export { GoogleReviewsAdapter } from './googleReviews.js';
export { AppStoreAdapter } from './appStore.js';
export { PlayStoreAdapter } from './playStore.js';
export { RssAdapter } from './rss.js';
export { YoutubeAdapter } from './youtube.js';
