import type { Dimension, SentimentLabel } from '@project-signal/shared-types';

/** The five perception dimensions, fixed across the codebase. */
export const DIMENSIONS: readonly Dimension[] = [
  'trust',
  'quality',
  'service',
  'value',
  'experience',
] as const;

/**
 * Exponential decay half-life, in days.
 *
 * From the product spec (§ Scoring): "items are weighted by an exponential decay function with
 * a 90-day half-life". A signal 90 days old counts half as much as one published today; at 180
 * days, a quarter. Note this is a half-life, not a cut-off — old signals fade rather than drop.
 */
export const HALF_LIFE_DAYS = 90;

/** Equal weighting, used when a brand has not configured its own. Sums to 1. */
export const DEFAULT_DIMENSION_WEIGHTS: Readonly<Record<Dimension, number>> = {
  trust: 0.2,
  quality: 0.2,
  service: 0.2,
  value: 0.2,
  experience: 0.2,
};

/** How many Brand impact clusters the spec surfaces. */
export const BRAND_IMPACT_TOP_N = 3;

/** One scored signal, as the rollup reads it out of `sentiment_results` joined to `signals`. */
export interface ScoredItem {
  signalId: string;
  publishedAt: Date;
  /** Model sentiment, −1 (most negative) … 1 (most positive). */
  score: number;
  /** Model confidence, 0 … 1. Used to weight the item's contribution. */
  confidence: number;
  label: SentimentLabel;
  dimensions: Dimension[];
  topics: string[];
}

export interface DimensionRollup {
  dimension: Dimension;
  /** 0–100 index. */
  score: number;
  /** Number of items that contributed, before weighting. */
  signalCount: number;
}

export interface TopicCluster {
  topic: string;
  /** Number of items carrying this topic. */
  volume: number;
  /** Mean negativity, 0 (nothing negative) … 1 (uniformly maximally negative). */
  negativity: number;
  /** Mean positivity, 0 (nothing positive) … 1 (uniformly maximally positive). */
  positivity: number;
  /** Mean recency weight of the cluster's items, 0 … 1. */
  recency: number;
  /** volume × negativity × recency — the spec's damage score. */
  damage: number;
  /**
   * volume × positivity × recency — the mirror of damage.
   *
   * Not in the product spec, which only defines Brand impact. Added deliberately as the
   * symmetric counterpart so "what is working" is ranked by the same construction as "what is
   * hurting", rather than by an ad-hoc rule invented in the view.
   */
  strength: number;
  /** Mean sentiment of the cluster, −1 … 1. */
  sentiment: number;
  /** Dimensions the cluster's items touch, most frequent first. */
  dimensions: Dimension[];
}
