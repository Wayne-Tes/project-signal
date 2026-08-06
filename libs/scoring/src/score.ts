import type { Dimension } from '@project-signal/shared-types';
import {
  ACHILLES_TOP_N,
  DEFAULT_DIMENSION_WEIGHTS,
  DIMENSIONS,
  HALF_LIFE_DAYS,
  type DimensionRollup,
  type ScoredItem,
  type TopicCluster,
} from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Exponential recency weight: `2 ^ (-age / halfLife)`.
 *
 * 1 at age 0, 0.5 at one half-life, 0.25 at two. Items published after `asOf` (clock skew, or a
 * source that back-dates) are clamped to weight 1 rather than allowed to exceed it.
 */
export function recencyWeight(
  publishedAt: Date,
  asOf: Date,
  halfLifeDays: number = HALF_LIFE_DAYS,
): number {
  const ageDays = (asOf.getTime() - publishedAt.getTime()) / MS_PER_DAY;
  if (ageDays <= 0) return 1;
  return Math.pow(2, -ageDays / halfLifeDays);
}

/** Maps model sentiment (−1 … 1) onto the spec's 0–100 index. */
export function toIndex(sentiment: number): number {
  const clamped = Math.min(1, Math.max(-1, sentiment));
  return ((clamped + 1) / 2) * 100;
}

/**
 * Scores one dimension as a weighted average of the sentiment of items tagged to it.
 *
 * Each item's weight is `recency × confidence`: an old signal and a signal the model was unsure
 * about both count for less. Returns `null` when no item touches the dimension — that is
 * distinct from a score of 0, which would mean uniformly negative sentiment.
 */
export function scoreDimension(
  items: readonly ScoredItem[],
  dimension: Dimension,
  asOf: Date,
  halfLifeDays: number = HALF_LIFE_DAYS,
): DimensionRollup | null {
  const relevant = items.filter((i) => i.dimensions.includes(dimension));
  if (relevant.length === 0) return null;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const item of relevant) {
    const weight = recencyWeight(item.publishedAt, asOf, halfLifeDays) * item.confidence;
    weightedSum += item.score * weight;
    weightTotal += weight;
  }

  // Every item can be weightless — all zero-confidence, or so old the decay underflows. Fall
  // back to an unweighted mean rather than dividing by zero.
  const mean =
    weightTotal > 0
      ? weightedSum / weightTotal
      : relevant.reduce((acc, i) => acc + i.score, 0) / relevant.length;

  return { dimension, score: toIndex(mean), signalCount: relevant.length };
}

/** Scores all five dimensions. Dimensions with no items are omitted, not zeroed. */
export function scoreAllDimensions(
  items: readonly ScoredItem[],
  asOf: Date,
  halfLifeDays: number = HALF_LIFE_DAYS,
): DimensionRollup[] {
  return DIMENSIONS.map((d) => scoreDimension(items, d, asOf, halfLifeDays)).filter(
    (r): r is DimensionRollup => r !== null,
  );
}

/**
 * The Brand Perception Index: a weighted composite of the dimension scores, 0–100.
 *
 * Weights are configurable per brand. Only dimensions that actually have a score participate,
 * and the weights are renormalised over those — otherwise a brand with no `value` signals would
 * be penalised as though its value score were zero, which is a data gap, not a bad score.
 *
 * Returns `null` when no dimension has data.
 */
export function compositeScore(
  rollups: readonly DimensionRollup[],
  weights: Readonly<Partial<Record<Dimension, number>>> = DEFAULT_DIMENSION_WEIGHTS,
): number | null {
  if (rollups.length === 0) return null;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const rollup of rollups) {
    const weight = weights[rollup.dimension] ?? 0;
    if (weight <= 0) continue;
    weightedSum += rollup.score * weight;
    weightTotal += weight;
  }

  // All present dimensions carry zero (or absent) weight — treat as unweighted rather than
  // reporting no score at all.
  if (weightTotal === 0) {
    return rollups.reduce((acc, r) => acc + r.score, 0) / rollups.length;
  }
  return weightedSum / weightTotal;
}

/**
 * Groups items by topic tag and scores each cluster's damage.
 *
 * Damage is the spec's `volume × negative sentiment × recency weight`. Negativity is the mean of
 * `max(0, -score)`, so positive items pull a cluster's negativity toward zero without ever
 * making damage negative. An item carrying several topics contributes to each.
 *
 * Sorted by damage, highest first.
 */
export function clusterTopics(
  items: readonly ScoredItem[],
  asOf: Date,
  halfLifeDays: number = HALF_LIFE_DAYS,
): TopicCluster[] {
  const byTopic = new Map<string, ScoredItem[]>();
  for (const item of items) {
    for (const topic of item.topics) {
      const key = topic.trim().toLowerCase();
      if (!key) continue;
      const bucket = byTopic.get(key);
      if (bucket) bucket.push(item);
      else byTopic.set(key, [item]);
    }
  }

  const clusters: TopicCluster[] = [];
  for (const [topic, bucket] of byTopic) {
    const volume = bucket.length;
    const negativity = bucket.reduce((acc, i) => acc + Math.max(0, -i.score), 0) / volume;
    const positivity = bucket.reduce((acc, i) => acc + Math.max(0, i.score), 0) / volume;
    const recency =
      bucket.reduce((acc, i) => acc + recencyWeight(i.publishedAt, asOf, halfLifeDays), 0) / volume;
    const sentiment = bucket.reduce((acc, i) => acc + i.score, 0) / volume;

    const dimCounts = new Map<Dimension, number>();
    for (const item of bucket) {
      for (const d of item.dimensions) dimCounts.set(d, (dimCounts.get(d) ?? 0) + 1);
    }
    const dimensions = [...dimCounts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);

    clusters.push({
      topic,
      volume,
      negativity,
      positivity,
      recency,
      damage: volume * negativity * recency,
      strength: volume * positivity * recency,
      sentiment,
      dimensions,
    });
  }

  return clusters.sort((a, b) => b.damage - a.damage);
}

/**
 * The Achilles Heel: the top clusters by damage.
 *
 * Clusters with zero damage are excluded — a topic nobody is negative about is not a weakness,
 * and padding the list to three would present neutral topics as problems.
 */
export function achillesHeels(
  clusters: readonly TopicCluster[],
  topN: number = ACHILLES_TOP_N,
): TopicCluster[] {
  return clusters.filter((c) => c.damage > 0).slice(0, topN);
}

/**
 * The mirror of the Achilles Heel: the clusters doing the most good.
 *
 * Ranked by `strength` rather than by taking the least-damaging clusters, which would surface
 * topics nobody mentioned. Zero-strength clusters are excluded for the same reason their
 * negative counterparts are: a topic with no positive sentiment is not a strength.
 */
export function topStrengths(
  clusters: readonly TopicCluster[],
  topN: number = ACHILLES_TOP_N,
): TopicCluster[] {
  return clusters
    .filter((c) => c.strength > 0)
    .slice()
    .sort((a, b) => b.strength - a.strength)
    .slice(0, topN);
}
