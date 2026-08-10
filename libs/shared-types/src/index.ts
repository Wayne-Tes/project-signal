// Signal sources supported by Project Signal.
export type SignalSource =
  | 'google_reviews'
  | 'trustpilot'
  | 'youtube'
  | 'app_store'
  | 'play_store'
  | 'rss'
  | 'reddit'
  | 'news_api'
  | 'x'
  | 'survey';

/**
 * The sources a collector actually exists for.
 *
 * `SignalSource` is what the SCHEMA models; this is what the pipeline can actually fetch. The
 * two are deliberately different, and conflating them hides a real failure: the integrations
 * endpoint accepted any string, so a source config for `trustpilot` could be stored, enabled and
 * shown as configured, and then throw "No adapter for source" on every single collection run —
 * where the error is counted as a failed source and dropped. Nothing surfaced to the person who
 * configured it.
 *
 * Kept in shared-types rather than in `libs/source-adapters` so the API can validate against it
 * without taking a dependency on every adapter's HTTP client. `apps/ingestion` has a test
 * asserting its adapter registry matches this list exactly, so the two cannot drift.
 */
export const COLLECTING_SOURCES = [
  'google_reviews',
  'app_store',
  'play_store',
  'rss',
  'reddit',
  'youtube',
] as const satisfies readonly SignalSource[];

export type CollectingSource = (typeof COLLECTING_SOURCES)[number];

export function isCollectingSource(value: string): value is CollectingSource {
  return (COLLECTING_SOURCES as readonly string[]).includes(value);
}

// The five brand perception dimensions.
export type Dimension = 'trust' | 'quality' | 'service' | 'value' | 'experience';

export type SentimentLabel = 'positive' | 'negative' | 'neutral' | 'mixed';

export interface Signal {
  id: string;
  tenantId: string;
  brandEntityId: string;
  source: SignalSource;
  sourceUrl: string;
  rawStorageRef: string;
  publishedAt: Date;
  ingestedAt: Date;
}

export interface SentimentResult {
  signalId: string;
  label: SentimentLabel;
  score: number; // -1 to 1
  confidence: number; // 0 to 1
  dimensions: Dimension[];
  topics: string[];
  modelVersion: string;
}

export interface BrandPerceptionScore {
  brandEntityId: string;
  computedAt: Date;
  overall: number; // 0–100
  dimensions: Record<Dimension, number>;
}

export interface Report {
  id: string;
  tenantId: string;
  brandEntityId: string;
  periodStart: Date;
  periodEnd: Date;
  storageRef: string;
  generatedAt: Date;
}
