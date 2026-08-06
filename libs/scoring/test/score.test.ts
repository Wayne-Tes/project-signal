import { describe, expect, it } from 'vitest';
import type { Dimension } from '@project-signal/shared-types';
import {
  achillesHeels,
  clusterTopics,
  compositeScore,
  DEFAULT_DIMENSION_WEIGHTS,
  HALF_LIFE_DAYS,
  recencyWeight,
  scoreAllDimensions,
  scoreDimension,
  toIndex,
  type ScoredItem,
} from '../src/index.js';

const ASOF = new Date('2026-08-06T00:00:00.000Z');
const daysBefore = (n: number) => new Date(ASOF.getTime() - n * 24 * 60 * 60 * 1000);

function item(over: Partial<ScoredItem> = {}): ScoredItem {
  return {
    signalId: 's1',
    publishedAt: ASOF,
    score: 0,
    confidence: 1,
    label: 'neutral',
    dimensions: ['trust'],
    topics: [],
    ...over,
  };
}

describe('recencyWeight', () => {
  // Spec § Scoring: "an exponential decay function with a 90-day half-life".
  it('is 1 for an item published now', () => {
    expect(recencyWeight(ASOF, ASOF)).toBe(1);
  });

  it('is exactly 0.5 at one half-life', () => {
    expect(recencyWeight(daysBefore(HALF_LIFE_DAYS), ASOF)).toBeCloseTo(0.5, 10);
  });

  it('is exactly 0.25 at two half-lives', () => {
    expect(recencyWeight(daysBefore(2 * HALF_LIFE_DAYS), ASOF)).toBeCloseTo(0.25, 10);
  });

  it('decays rather than cutting off past the half-life', () => {
    expect(recencyWeight(daysBefore(365), ASOF)).toBeGreaterThan(0);
  });

  it('clamps a future-dated item to 1 instead of amplifying it', () => {
    expect(recencyWeight(new Date(ASOF.getTime() + 10 * 86_400_000), ASOF)).toBe(1);
  });
});

describe('toIndex', () => {
  it('maps the sentiment range onto 0-100', () => {
    expect(toIndex(-1)).toBe(0);
    expect(toIndex(0)).toBe(50);
    expect(toIndex(1)).toBe(100);
  });

  it('clamps out-of-range model output', () => {
    expect(toIndex(-4)).toBe(0);
    expect(toIndex(4)).toBe(100);
  });
});

describe('scoreDimension', () => {
  it('returns null when nothing touches the dimension, rather than a zero score', () => {
    expect(scoreDimension([item({ dimensions: ['quality'] })], 'trust', ASOF)).toBeNull();
  });

  it('weights recent signals above old ones', () => {
    // One strongly negative item today, one strongly positive a year ago. Recency should pull
    // the result below the midpoint.
    const rollup = scoreDimension(
      [
        item({ signalId: 'new', score: -1, publishedAt: ASOF }),
        item({ signalId: 'old', score: 1, publishedAt: daysBefore(365) }),
      ],
      'trust',
      ASOF,
    );
    expect(rollup!.score).toBeLessThan(50);
    expect(rollup!.signalCount).toBe(2);
  });

  it('weights confident signals above unsure ones', () => {
    const rollup = scoreDimension(
      [
        item({ signalId: 'sure', score: -1, confidence: 1 }),
        item({ signalId: 'unsure', score: 1, confidence: 0.1 }),
      ],
      'trust',
      ASOF,
    );
    expect(rollup!.score).toBeLessThan(50);
  });

  it('falls back to an unweighted mean when every item is weightless', () => {
    const rollup = scoreDimension(
      [item({ score: 1, confidence: 0 }), item({ score: 1, confidence: 0 })],
      'trust',
      ASOF,
    );
    expect(rollup!.score).toBe(100);
  });

  it('counts contributing signals regardless of their weight', () => {
    const rollup = scoreDimension([item({ publishedAt: daysBefore(900) }), item()], 'trust', ASOF);
    expect(rollup!.signalCount).toBe(2);
  });
});

describe('scoreAllDimensions', () => {
  it('omits dimensions with no data instead of reporting them as zero', () => {
    const rollups = scoreAllDimensions([item({ dimensions: ['trust', 'service'] })], ASOF);
    expect(rollups.map((r) => r.dimension).sort()).toEqual(['service', 'trust']);
  });
});

describe('compositeScore', () => {
  it('returns null when there is nothing to score', () => {
    expect(compositeScore([])).toBeNull();
  });

  it('averages evenly under the default weights', () => {
    const score = compositeScore(
      [
        { dimension: 'trust', score: 80, signalCount: 1 },
        { dimension: 'quality', score: 40, signalCount: 1 },
      ],
      DEFAULT_DIMENSION_WEIGHTS,
    );
    expect(score).toBeCloseTo(60, 10);
  });

  it('honours per-brand weights', () => {
    const score = compositeScore(
      [
        { dimension: 'trust', score: 100, signalCount: 1 },
        { dimension: 'quality', score: 0, signalCount: 1 },
      ],
      { trust: 0.9, quality: 0.1 },
    );
    expect(score).toBeCloseTo(90, 10);
  });

  // A brand with no `value` signals has a data gap, not a bad value score. Weighting the
  // missing dimension in as a zero would silently punish it.
  it('renormalises over present dimensions rather than penalising missing ones', () => {
    const partial = compositeScore(
      [{ dimension: 'trust', score: 80, signalCount: 1 }],
      DEFAULT_DIMENSION_WEIGHTS,
    );
    expect(partial).toBeCloseTo(80, 10);
  });

  it('falls back to an unweighted mean when present dimensions carry no weight', () => {
    const score = compositeScore([{ dimension: 'trust', score: 70, signalCount: 1 }], {
      quality: 1,
    });
    expect(score).toBeCloseTo(70, 10);
  });
});

describe('clusterTopics', () => {
  it('groups case-insensitively and counts volume', () => {
    const clusters = clusterTopics(
      [item({ topics: ['App Crashes'] }), item({ topics: ['app crashes'] })],
      ASOF,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.topic).toBe('app crashes');
    expect(clusters[0]!.volume).toBe(2);
  });

  it('counts an item under each of its topics', () => {
    const clusters = clusterTopics([item({ topics: ['fees', 'support'] })], ASOF);
    expect(clusters.map((c) => c.topic).sort()).toEqual(['fees', 'support']);
  });

  it('ignores empty topic tags', () => {
    expect(clusterTopics([item({ topics: ['', '  '] })], ASOF)).toHaveLength(0);
  });

  // Spec § Achilles Heel: damage = volume × negative sentiment × recency weight.
  it('computes damage as volume x negativity x recency', () => {
    const [cluster] = clusterTopics(
      [
        item({ score: -1, topics: ['fees'], publishedAt: ASOF }),
        item({ score: -1, topics: ['fees'], publishedAt: ASOF }),
      ],
      ASOF,
    );
    // volume 2 × negativity 1 × recency 1
    expect(cluster!.damage).toBeCloseTo(2, 10);
  });

  it('treats positive sentiment as zero damage, never negative damage', () => {
    const [cluster] = clusterTopics([item({ score: 1, topics: ['praise'] })], ASOF);
    expect(cluster!.negativity).toBe(0);
    expect(cluster!.damage).toBe(0);
  });

  it('discounts an old complaint below an equally severe recent one', () => {
    const clusters = clusterTopics(
      [
        item({ score: -1, topics: ['recent'], publishedAt: ASOF }),
        item({ score: -1, topics: ['stale'], publishedAt: daysBefore(2 * HALF_LIFE_DAYS) }),
      ],
      ASOF,
    );
    const recent = clusters.find((c) => c.topic === 'recent')!;
    const stale = clusters.find((c) => c.topic === 'stale')!;
    expect(recent.damage).toBeGreaterThan(stale.damage);
    expect(stale.damage).toBeCloseTo(0.25, 10);
  });

  it('sorts by damage, worst first', () => {
    const clusters = clusterTopics(
      [
        item({ score: -0.2, topics: ['minor'] }),
        item({ score: -1, topics: ['major'] }),
        item({ score: -1, topics: ['major'] }),
      ],
      ASOF,
    );
    expect(clusters[0]!.topic).toBe('major');
  });

  it('reports the dimensions a cluster touches, most frequent first', () => {
    const [cluster] = clusterTopics(
      [
        item({ score: -1, topics: ['fees'], dimensions: ['value'] }),
        item({ score: -1, topics: ['fees'], dimensions: ['value', 'trust'] }),
      ],
      ASOF,
    );
    expect(cluster!.dimensions[0]).toBe<Dimension>('value');
  });
});

describe('achillesHeels', () => {
  it('returns the top three by damage', () => {
    const clusters = clusterTopics(
      [
        item({ score: -1, topics: ['a'] }),
        item({ score: -0.9, topics: ['b'] }),
        item({ score: -0.8, topics: ['c'] }),
        item({ score: -0.7, topics: ['d'] }),
      ],
      ASOF,
    );
    expect(achillesHeels(clusters).map((c) => c.topic)).toEqual(['a', 'b', 'c']);
  });

  // Padding to three would present topics nobody complained about as weaknesses.
  it('excludes zero-damage clusters rather than padding the list', () => {
    const clusters = clusterTopics(
      [item({ score: -1, topics: ['real'] }), item({ score: 1, topics: ['praise'] })],
      ASOF,
    );
    expect(achillesHeels(clusters).map((c) => c.topic)).toEqual(['real']);
  });

  it('returns nothing when there is no negativity at all', () => {
    const clusters = clusterTopics([item({ score: 0.5, topics: ['good'] })], ASOF);
    expect(achillesHeels(clusters)).toEqual([]);
  });
});
