import type { Signal } from '@project-signal/shared-types';
import { startApifyRun, waitForApifyRun, fetchApifyDataset } from './apifyClient.js';
import type { SourceAdapter, AdapterConfig, FetchResult, RawItem } from './index.js';
import { clampContent, stripHtml } from './text.js';
import { baseSignal, isUsable, newerThan } from './common.js';

const ACTOR_ID = 'compass~google-maps-reviews-scraper';

interface ApifyReview {
  reviewId?: string;
  reviewUrl?: string;
  text?: string;
  publishedAtDate?: string;
  stars?: number;
  name?: string;
}

export class GoogleReviewsAdapter implements SourceAdapter {
  readonly source = 'google_reviews' as const;

  async fetch(config: AdapterConfig, since?: Date): Promise<FetchResult> {
    const apiKey = config.credentials?.['apifyApiKey'];
    const placeId = config.credentials?.['placeId'];
    if (!apiKey) throw new Error('apifyApiKey required in credentials');
    if (!placeId) throw new Error('placeId required in credentials');

    const input: Record<string, unknown> = { placeIds: [placeId], maxReviews: 100 };
    if (since) input['cutoffDate'] = since.toISOString().slice(0, 10);

    const run = await startApifyRun(apiKey, ACTOR_ID, input);
    const completed = await waitForApifyRun(apiKey, run.id);
    const reviews = await fetchApifyDataset<ApifyReview>(apiKey, completed.defaultDatasetId);

    /* A star rating with no words is common on Google, and has nothing to score: storing it made a
       signal whose only fate was a permanent scoring failure. `cutoffDate` is day-granular, so the
       precise watermark is also applied here — otherwise the watermark day re-collects every run. */
    return { items: newerThan(reviews.map(toRawItem).filter(isUsable), since) };
  }

  toSignal(
    item: RawItem,
    config: AdapterConfig,
  ): Omit<Signal, 'id' | 'ingestedAt' | 'rawStorageRef'> {
    return baseSignal(this.source, item, config);
  }
}

function toRawItem(review: ApifyReview): RawItem {
  return {
    externalId: review.reviewId ?? review.reviewUrl ?? '',
    url: review.reviewUrl ?? '',
    text: clampContent(stripHtml(String(review.text ?? ''))),
    sourceText: review.text === undefined || review.text === null ? undefined : String(review.text),
    /* A Google review has no title, and its rating is `stars` rather than `rating` — the reason
       these are normalised onto RawItem instead of left for the UI to alias per source. */
    author: review.name,
    rating: review.stars,
    publishedAt: review.publishedAtDate ? new Date(review.publishedAtDate) : new Date(),
    metadata: { stars: review.stars, reviewerName: review.name },
  };
}
