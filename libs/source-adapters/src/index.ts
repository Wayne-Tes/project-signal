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

/**
 * One collected item, before it becomes a signal.
 *
 * `title`, `author` and `rating` are NORMALISED fields, added so the drill-down can render a
 * review the way a person expects to read it. Every adapter already had this information and
 * every adapter buried it in `metadata` under a different key — `author` (Reddit, App Store),
 * `reviewerName` (Play Store, Google), `authorName` (YouTube); `rating` (App Store, Play Store)
 * versus `stars` (Google). A UI reading `metadata` would need to know all six aliases, and would
 * silently render nothing for the seventh source somebody adds.
 *
 * They are optional because they are genuinely absent for some sources: an RSS item has no
 * author, a Reddit post has no star rating. Absent is rendered as absent, never as a zero.
 */
export interface RawItem {
  externalId: string;
  url: string;
  /** The verbatim words. Markup already stripped — see `text.ts` for why that happens here. */
  text: string;
  /**
   * WHAT THE SOURCE ACTUALLY RETURNED, before any normalisation. Persisted to S3, never read
   * by the pipeline.
   *
   * `text` above is processed: markup stripped, entities decoded, title joined, paragraphs
   * deduplicated, clamped. That is the right thing to score and to show — and it means the S3
   * object, which is written from it, was never the untouched payload it was described as
   * (KNOWN-GAPS #28). Because the object key is derived from the external id, re-collecting an
   * item OVERWRITES it, so after a normalisation change ships the stored "raw" payload is
   * quietly rewritten in the new shape.
   *
   * That is not theoretical: a fix for duplicated Google News headlines failed to repair the
   * rows it was written for, because the backfill re-read a source that had itself already been
   * rewritten with the duplication baked in.
   *
   * Carrying the original here means a future normalisation change can be re-derived from what
   * the source said rather than from what we last decided it said. Optional because a source
   * with a single plain-text field has nothing distinct to carry, and inventing a copy would
   * just double the object for no information.
   */
  sourceText?: string;
  /** The source's own title, before normalisation. Same reasoning as `sourceText`. */
  sourceTitle?: string;
  /** Headline or subject, where the source distinguishes one from the body. */
  title?: string;
  /** Who said it, as the source names them. */
  author?: string;
  /** Star rating, on the source's own scale (1–5 for every store we read). */
  rating?: number;
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

export {
  clampContent,
  decodeEntities,
  dedupeParagraphs,
  joinTitleAndBody,
  stripHtml,
  MAX_CONTENT_LENGTH,
} from './text.js';

export { GoogleReviewsAdapter } from './googleReviews.js';
export { AppStoreAdapter } from './appStore.js';
export { PlayStoreAdapter } from './playStore.js';
export { RedditAdapter } from './reddit.js';
export { RssAdapter } from './rss.js';
export { YoutubeAdapter } from './youtube.js';
