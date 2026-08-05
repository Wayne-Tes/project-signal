import type { Signal } from '@project-signal/shared-types';
import { startApifyRun, waitForApifyRun, fetchApifyDataset } from './apifyClient.js';
import type { SourceAdapter, AdapterConfig, FetchResult, RawItem } from './index.js';

// https://apify.com/emastra/google-play-scraper
const ACTOR_ID = 'emastra~google-play-scraper';

interface PlayStoreReview {
  reviewId?: string;
  userName?: string;
  content?: string;
  score?: number;
  at?: string;
  appId?: string;
  appUrl?: string;
}

export class PlayStoreAdapter implements SourceAdapter {
  readonly source = 'play_store' as const;

  async fetch(config: AdapterConfig, since?: Date): Promise<FetchResult> {
    const apiKey = config.credentials?.['apifyApiKey'];
    const appId = config.credentials?.['appId'];
    if (!apiKey) throw new Error('apifyApiKey required in credentials');
    if (!appId) throw new Error('appId required in credentials');

    const input: Record<string, unknown> = { appId, maxReviews: 100, sort: 'newest' };
    if (since) input['startDate'] = since.toISOString().slice(0, 10);

    const run = await startApifyRun(apiKey, ACTOR_ID, input);
    const completed = await waitForApifyRun(apiKey, run.id);
    const reviews = await fetchApifyDataset<PlayStoreReview>(apiKey, completed.defaultDatasetId);

    return { items: reviews.filter((r) => r.content).map(toRawItem) };
  }

  toSignal(item: RawItem, config: AdapterConfig): Omit<Signal, 'id' | 'ingestedAt' | 'rawStorageRef'> {
    return {
      tenantId: config.tenantId,
      brandEntityId: config.brandEntityId,
      source: this.source,
      sourceUrl: item.url,
      publishedAt: item.publishedAt,
    };
  }
}

function toRawItem(review: PlayStoreReview): RawItem {
  const url =
    review.appUrl ??
    `https://play.google.com/store/apps/details?id=${review.appId ?? ''}`;
  return {
    externalId: review.reviewId ?? '',
    url,
    text: review.content ?? '',
    publishedAt: review.at ? new Date(review.at) : new Date(),
    metadata: { score: review.score, reviewerName: review.userName },
  };
}
