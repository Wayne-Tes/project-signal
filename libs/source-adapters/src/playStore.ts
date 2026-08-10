import type { Signal } from '@project-signal/shared-types';
import { startApifyRun, waitForApifyRun, fetchApifyDataset } from './apifyClient.js';
import type { SourceAdapter, AdapterConfig, FetchResult, RawItem } from './index.js';
import { clampContent, stripHtml } from './text.js';

/**
 * `neatrat/google-play-store-reviews-scraper`.
 *
 * REPLACES `emastra~google-play-scraper`, WHICH NO LONGER EXISTS —
 * `GET /v2/acts/emastra~google-play-scraper` returns **404**, so this source could not have
 * worked whatever credential was configured. An actor id decays exactly like a model id, and
 * this repository has now shipped both.
 *
 * The replacement's input schema was read from `GET /v2/actor-builds/{id}` and its output from a
 * real run against `com.classcharts.android.student` on 2026-08-10 — the field names below are
 * that response, not a guess.
 */
const ACTOR_ID = 'neatrat~google-play-store-reviews-scraper';

/** Reviews per page. The actor rejects anything below 10 — found by having it reject 3. */
const REVIEWS_PER_PAGE = 100;

/** One dataset row, verbatim from a verified run. */
interface PlayStoreReview {
  reviewId?: string;
  rating?: number;
  reviewer?: string;
  /** `YYYY-MM-DD`. `timestamp` carries the same moment in epoch seconds. */
  date?: string;
  timestamp?: number;
  body?: string;
  appId?: string;
  appVersion?: string;
  helpfulCounts?: number;
  language?: string;
}

export class PlayStoreAdapter implements SourceAdapter {
  readonly source = 'play_store' as const;

  async fetch(config: AdapterConfig, since?: Date): Promise<FetchResult> {
    const apiKey = config.credentials?.['apifyApiKey'];
    const appId = config.credentials?.['appId'];
    if (!apiKey) throw new Error('apifyApiKey required in credentials');
    if (!appId) throw new Error('appId required in credentials');

    const input: Record<string, unknown> = {
      /* The field is `appIdOrUrl` and takes either. A package name is what the UI asks for. */
      appIdOrUrl: appId,
      sortBy: 'newest',
      maxReviews: 100,
      pagesToScrape: 1,
      reviewsPerPage: REVIEWS_PER_PAGE,
    };
    /* Filtered locally rather than through the actor's `recentDays`, which takes a day count
       rather than a date and would round a precise watermark to something coarser. */

    const run = await startApifyRun(apiKey, ACTOR_ID, input);
    const completed = await waitForApifyRun(apiKey, run.id);
    const reviews = await fetchApifyDataset<PlayStoreReview>(apiKey, completed.defaultDatasetId);

    let items = reviews.filter((r) => r.body).map(toRawItem);
    if (since) items = items.filter((item) => item.publishedAt > since);
    return { items };
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
  /* The actor returns no per-review URL — Play Store reviews have no permalink — so the app's
     listing is the honest destination. Better than an empty link that renders as unclickable
     evidence in the drill-down. */
  const url = `https://play.google.com/store/apps/details?id=${review.appId ?? ''}`;

  return {
    externalId: review.reviewId ?? '',
    url,
    text: clampContent(stripHtml(String(review.body ?? ''))),
    /* Play Store reviews have no title — the body is the whole review. Left undefined rather
       than duplicating the body into it, so the UI can tell "no headline" from "headline". */
    author: review.reviewer,
    rating: review.rating,
    /* `timestamp` is epoch SECONDS and `date` is only `YYYY-MM-DD`. The timestamp is preferred
       because a date alone collapses every review from one day onto midnight, which makes the
       per-feed watermark re-collect them on every run. */
    publishedAt: review.timestamp
      ? new Date(review.timestamp * 1000)
      : review.date
        ? new Date(review.date)
        : new Date(),
    metadata: {
      rating: review.rating,
      reviewerName: review.reviewer,
      version: review.appVersion,
      helpful: review.helpfulCounts,
    },
  };
}
