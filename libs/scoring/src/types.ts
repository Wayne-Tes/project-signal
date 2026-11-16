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

/**
 * How far back anything that reads scored signals looks: four half-lives.
 *
 * Past that an item carries under 1/16th weight, and reading the whole history on every run would
 * grow without bound. The rollup and the projection MUST use the same window — a projection over a
 * different window than the index it projects is a forecast of a different number — so it is
 * defined once, here.
 */
export const LOOKBACK_DAYS = HALF_LIFE_DAYS * 4;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The canonical form of a topic tag: trimmed and lower-cased.
 *
 * The model is asked for lowercase tags and does not always comply, so "Fees" and "fees " must
 * land in one cluster. Every function that groups or matches by topic uses this, so two views of
 * the same data cannot disagree about which cluster a tag belongs to.
 */
export function normaliseTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

/**
 * Bounds an item's model outputs before they are weighted.
 *
 * The worker validates and clamps at write time, but rows written before that existed — and any
 * future writer — are not guaranteed to. One score of 1.3 skews a whole dimension's weighted mean,
 * and a negative confidence becomes a negative weight that can flip the sign of the result. The
 * pure scoring functions therefore never trust the range they are handed.
 */
export function boundedScore(score: number): number {
  return Number.isFinite(score) ? Math.min(1, Math.max(-1, score)) : 0;
}

export function boundedConfidence(confidence: number): number {
  return Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
}

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
  /** Number of distinct items carrying this topic. */
  volume: number;
  /** Mean negativity, 0 (nothing negative) … 1 (uniformly maximally negative). */
  negativity: number;
  /** Mean positivity, 0 (nothing positive) … 1 (uniformly maximally positive). */
  positivity: number;
  /** Mean recency weight of the cluster's items, 0 … 1. */
  recency: number;
  /**
   * The spec's damage score, `volume × negative sentiment × recency`, computed PER ITEM:
   * Σ negativityᵢ × recencyᵢ (equivalently, volume × mean(negativity × recency)).
   *
   * It used to be the product of three MEANS — volume × mean negativity × mean recency — which
   * pairs negativity and recency from different items. A cluster of one old complaint and one
   * fresh compliment then scored as recent damage: the complaint supplied the negativity and the
   * compliment supplied the recency, though nothing recent was negative at all.
   */
  damage: number;
  /**
   * Σ positivityᵢ × recencyᵢ — the mirror of damage.
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
