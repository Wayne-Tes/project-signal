import { describe, expect, it } from 'vitest';
import {
  counterfactual,
  gapTo,
  median,
  project,
  resolveTarget,
  type Benchmarks,
} from '../src/target.js';
import type { ScoredItem } from '../src/types.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-17T12:00:00.000Z');

function item(over: Partial<ScoredItem> & { daysAgo: number }): ScoredItem {
  return {
    signalId: over.signalId ?? `s-${over.daysAgo}-${over.score ?? 0}-${(over.topics ?? []).join()}`,
    publishedAt: new Date(NOW.getTime() - over.daysAgo * DAY),
    score: over.score ?? 0,
    confidence: over.confidence ?? 1,
    label: over.label ?? 'neutral',
    dimensions: over.dimensions ?? ['trust'],
    topics: over.topics ?? [],
  };
}

const NO_BENCHMARKS: Benchmarks = {
  competitorMedian: null,
  competitorBest: null,
  competitorCount: 0,
  internalBest: null,
};

describe('median', () => {
  /* The mean lets one competitor with almost no signals set the whole brand's target. */
  it('is not moved by a single wild outlier the way a mean is', () => {
    expect(median([60, 62, 64])).toBe(62);
    expect(median([60, 62, 64, 2])).toBe(61);
  });

  it('returns null rather than NaN for an empty set', () => {
    expect(median([])).toBeNull();
    expect(median([Number.NaN])).toBeNull();
  });
});

describe('resolveTarget', () => {
  it("prefers the owner's decision over anything inferred", () => {
    const t = resolveTarget(70, { ...NO_BENCHMARKS, competitorMedian: 63, competitorCount: 3 });
    expect(t).toMatchObject({ value: 70, source: 'owner' });
  });

  /* The median, not the best: beating the median is a credible quarter's work, and a target
     nobody believes is a target nobody uses. */
  it('defaults to the competitor median and says how many it came from', () => {
    const t = resolveTarget(null, {
      competitorMedian: 63,
      competitorBest: 71,
      competitorCount: 3,
      internalBest: null,
    });
    expect(t).toMatchObject({ value: 63, source: 'competitor-median' });
    expect(t!.label).toContain('3 tracked competitors');
  });

  it('falls back to the brand’s own strongest scope when no competitor is scored', () => {
    const t = resolveTarget(null, {
      ...NO_BENCHMARKS,
      internalBest: { value: 78, label: 'Australia' },
    });
    expect(t).toMatchObject({ value: 78, source: 'internal-best' });
    expect(t!.label).toContain('Australia');
  });

  /**
   * The point of the whole module. With nothing measured to aim at, the honest answer is "no
   * target", not a plausible round number — inventing 75 here is precisely the fabrication that
   * put `+3.4 pts` on a fictional bank's roadmap.
   */
  it('returns null rather than inventing a number when nothing is measurable', () => {
    expect(resolveTarget(null, NO_BENCHMARKS)).toBeNull();
    expect(resolveTarget(undefined, NO_BENCHMARKS)).toBeNull();
  });

  it('always states where the target came from', () => {
    const cases = [
      resolveTarget(70, NO_BENCHMARKS),
      resolveTarget(null, { ...NO_BENCHMARKS, competitorMedian: 63, competitorCount: 1 }),
      resolveTarget(null, { ...NO_BENCHMARKS, internalBest: { value: 78, label: 'AU' } }),
    ];
    for (const t of cases) expect(t!.label.length).toBeGreaterThan(0);
  });
});

describe('counterfactual', () => {
  const weights = { trust: 1 };

  it('reports the gain from removing a subject’s negativity', () => {
    const items = [
      item({ daysAgo: 1, score: -0.8, topics: ['pricing'] }),
      item({ daysAgo: 1, score: 0.6, topics: ['support'] }),
    ];
    const cf = counterfactual(items, 'pricing', NOW, weights)!;

    expect(cf.affectedSignals).toBe(1);
    expect(cf.to).toBeGreaterThan(cf.from);
    expect(cf.delta).toBeCloseTo(cf.to - cf.from);
  });

  /**
   * Neutralised, not removed. Dropping the items would also drop their positive mentions and
   * change every count, overstating the gain — the number would be wrong in the direction that
   * flatters us, which is the worst direction for a number a client reads.
   */
  it('leaves positive mentions of the same subject untouched', () => {
    const items = [
      item({ daysAgo: 1, score: -0.8, topics: ['pricing'] }),
      item({ daysAgo: 1, score: 0.9, topics: ['pricing'] }),
    ];
    const cf = counterfactual(items, 'pricing', NOW, weights)!;
    expect(cf.affectedSignals).toBe(1);
  });

  it('is worth nothing when the subject carries no negativity', () => {
    const items = [item({ daysAgo: 1, score: 0.5, topics: ['pricing'] })];
    const cf = counterfactual(items, 'pricing', NOW, weights)!;
    expect(cf.affectedSignals).toBe(0);
    expect(cf.delta).toBe(0);
  });

  it('never reports a negative gain from floating-point noise', () => {
    const items = [item({ daysAgo: 5, score: 0.3, topics: ['x'] })];
    expect(counterfactual(items, 'x', NOW, weights)!.delta).toBeGreaterThanOrEqual(0);
  });

  it('matches the topic case- and whitespace-insensitively', () => {
    const items = [item({ daysAgo: 1, score: -0.8, topics: [' Pricing '] })];
    expect(counterfactual(items, 'pricing', NOW, weights)!.affectedSignals).toBe(1);
  });

  it('returns null when there is no score to compare against', () => {
    expect(counterfactual([], 'pricing', NOW, weights)).toBeNull();
  });
});

describe('project', () => {
  const weights = { trust: 1 };

  /**
   * THE PROPERTY THAT INVALIDATED THE FIRST VERSION OF THIS MODULE, pinned so nobody restores the
   * comfortable assumption.
   *
   * "Old complaints fade, so the index recovers" is arithmetically FALSE here. `scoreDimension` is
   * a weighted mean; advancing `asOf` multiplies every weight by the same constant `2^(-T/90)`,
   * and a weighted mean is invariant under a uniform scaling of its weights. Decay alone moves
   * this score by exactly zero.
   */
  it('does not move at all from decay alone — the index does not heal by itself', () => {
    const items = [
      item({ daysAgo: 200, score: -0.9, topics: ['old'] }),
      item({ daysAgo: 2, score: 0.6, topics: ['new'] }),
    ];
    /* A horizon short enough that nothing leaves the 360-day window. */
    const p = project(items, NOW, null, weights, 120)!;
    expect(p.points.at(-1)!.score).toBeCloseTo(p.points[0]!.score, 10);
    expect(p.decliningWithoutAction).toBe(false);
  });

  /**
   * What genuinely moves it: the LOOKBACK CUT-OFF. Items published more than `LOOKBACK_DAYS` ago
   * are not scored at all, so as time passes the oldest leave the set — and the mean changes.
   * Each point is what the rollup will itself compute on that day.
   */
  it('improves as old negative signals age out of the scoring window', () => {
    const items = [
      item({ daysAgo: 350, score: -0.9, topics: ['old'] }),
      item({ daysAgo: 2, score: 0.6, topics: ['new'] }),
    ];
    const p = project(items, NOW, null, weights)!;
    expect(p.points.at(-1)!.score).toBeGreaterThan(p.points[0]!.score);
    expect(p.decliningWithoutAction).toBe(false);
  });

  /**
   * The finding that makes this worth showing at all. When the signals ageing out are the POSITIVE
   * ones, doing nothing makes things worse — which deserves saying out loud rather than leaving in
   * a chart.
   */
  it('declines when the signals ageing out are the positive ones', () => {
    const items = [
      item({ daysAgo: 350, score: 0.9, topics: ['old'] }),
      item({ daysAgo: 2, score: -0.8, topics: ['new'] }),
    ];
    const p = project(items, NOW, null, weights)!;
    expect(p.points.at(-1)!.score).toBeLessThan(p.points[0]!.score);
    expect(p.decliningWithoutAction).toBe(true);
  });

  it('reports when a target is reached, in whole weeks', () => {
    const items = [
      item({ daysAgo: 350, score: -0.9, topics: ['old'] }),
      item({ daysAgo: 2, score: 0.6, topics: ['new'] }),
    ];
    const p = project(items, NOW, 70, weights)!;
    expect(p.daysToTarget).not.toBeNull();
    expect(p.daysToTarget! % 7).toBe(0);
  });

  /* Null, not the horizon. "360 days" reads as an estimate; null reads as "not from doing
     nothing", which is the truth and is the whole argument for taking an action. */
  it('reports null when nothing but action can reach the target', () => {
    const items = [item({ daysAgo: 2, score: -0.9, topics: ['x'] })];
    expect(project(items, NOW, 95, weights)!.daysToTarget).toBeNull();
  });

  it('reports the target as already met at day zero', () => {
    const items = [item({ daysAgo: 2, score: 0.9, topics: ['x'] })];
    expect(project(items, NOW, 50, weights)!.daysToTarget).toBe(0);
  });

  it('returns null when there is nothing to project', () => {
    expect(project([], NOW, 70, weights)).toBeNull();
  });
});

describe('gapTo', () => {
  it('is the distance to the target', () => {
    expect(gapTo(51.6, { value: 63, source: 'owner', label: 'x' })).toBeCloseTo(11.4);
  });

  /* Zero, never negative. A brand past its target is not "-4 to go", and showing that is how a
     roadmap urges someone to close a gap they have already closed. */
  it('is zero once the target is met or beaten', () => {
    expect(gapTo(70, { value: 63, source: 'owner', label: 'x' })).toBe(0);
  });

  it('is null when either side is missing', () => {
    expect(gapTo(null, { value: 63, source: 'owner', label: 'x' })).toBeNull();
    expect(gapTo(51, null)).toBeNull();
  });
});
