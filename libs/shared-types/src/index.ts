// Signal sources supported by Project Signal.
export type SignalSource =
  | 'google_reviews'
  | 'trustpilot'
  | 'youtube'
  | 'app_store'
  | 'play_store'
  | 'rss'
  | 'news_api'
  | 'x'
  | 'survey';

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
