import type { Signal } from '@project-signal/shared-types';
import { startApifyRun, waitForApifyRun, fetchApifyDataset } from './apifyClient.js';
import type { SourceAdapter, AdapterConfig, FetchResult, RawItem } from './index.js';

// https://apify.com/nikita-shakula/app-store-scraper
const ACTOR_ID = 'nikita-shakula~app-store-scraper';

interface AppStoreReview {
  id?: string;
  url?: string;
  title?: string;
  text?: string;
  score?: number;
  date?: string;
  userName?: string;
}

export class AppStoreAdapter implements SourceAdapter {
  readonly source = 'app_store' as const;

  async fetch(config: AdapterConfig, since?: Date): Promise<FetchResult> {
    const apiKey = config.credentials?.['apifyApiKey'];
    const appId = config.credentials?.['appId'];
    const country = config.credentials?.['country'] ?? 'us';
    if (!apiKey) throw new Error('apifyApiKey required in credentials');
    if (!appId) throw new Error('appId required in credentials');

    const input: Record<string, unknown> = { appIds: [appId], country, maxReviews: 100 };
    if (since) input['startDate'] = since.toISOString().slice(0, 10);

    const run = await startApifyRun(apiKey, ACTOR_ID, input);
    const completed = await waitForApifyRun(apiKey, run.id);
    const reviews = await fetchApifyDataset<AppStoreReview>(apiKey, completed.defaultDatasetId);

    return { items: reviews.filter((r) => r.text).map(toRawItem) };
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

function toRawItem(review: AppStoreReview): RawItem {
  return {
    externalId: review.id ?? review.url ?? '',
    url: review.url ?? '',
    text: [review.title, review.text].filter(Boolean).join('\n'),
    publishedAt: review.date ? new Date(review.date) : new Date(),
    metadata: { score: review.score, reviewerName: review.userName },
  };
}
