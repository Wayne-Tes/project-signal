import { describe, expect, it } from 'vitest';
import {
  achievableSummary,
  evidenceNote,
  formatHorizon,
  roadmapHeadline,
  type ApiRoadmap,
} from '@/lib/brand-data';

const base: ApiRoadmap = {
  current: 51.6,
  target: { value: 63, source: 'competitor-median', label: 'median of 3 tracked competitors' },
  gap: 11.4,
  benchmarks: {
    competitorMedian: 63,
    competitorBest: 71,
    competitorCount: 3,
    internalBest: { value: 78, label: 'Australia' },
  },
  projection: {
    assumption: 'no new signals arrive',
    daysToTarget: null,
    decliningWithoutAction: false,
    points: [],
  },
  actions: [],
};

const action = (delta: number, topic = 'pricing') => ({
  topic,
  volume: 12,
  sentiment: -0.4,
  damage: 4,
  damageShare: 40,
  dimensions: ['trust'],
  play: null,
  ifResolved: { from: 51.6, to: 51.6 + delta, delta, affectedSignals: 6 },
});

describe('roadmapHeadline', () => {
  it('states where you are, where you are aiming, and where the target came from', () => {
    const h = roadmapHeadline(base);
    expect(h).toContain('51.6');
    expect(h).toContain('63.0');
    /* A target with no stated provenance is just a number. */
    expect(h).toContain('median of 3 tracked competitors');
    expect(h).toContain('11.4 points to close');
  });

  /**
   * The whole point of the module. With no competitor tracked and no second territory there is
   * nothing measurable to aim at, and the honest output says so and says what would fix it — a
   * plausible round number here would be an invented industry standard.
   */
  it('says there is no target rather than inventing one', () => {
    const h = roadmapHeadline({ ...base, target: null, gap: null });
    expect(h).toContain('No target yet');
    expect(h).toMatch(/set one|add a competitor/);
  });

  it('reads differently once the target is met', () => {
    const h = roadmapHeadline({ ...base, current: 70, gap: 0 });
    expect(h).toContain('at or above your target');
    expect(h).not.toContain('points to close');
  });

  it('handles a brand with no index at all', () => {
    expect(roadmapHeadline({ ...base, current: null })).toContain('No Brand Perception Index yet');
  });
});

describe('achievableSummary', () => {
  /* The question a quarter gets planned around: is the work on this page ENOUGH? */
  it('says when the listed work can close the gap', () => {
    const s = achievableSummary({ ...base, actions: [action(8), action(5, 'support')] })!;
    expect(s).toContain('13.0');
    expect(s).toContain('reachable from this list alone');
  });

  /* The more valuable direction, and the one a ranked list alone can never tell you. */
  it('says plainly when it cannot, and what else is needed', () => {
    const s = achievableSummary({ ...base, actions: [action(2)] })!;
    expect(s).toContain('short of the 11.4 needed');
    expect(s).toContain('new positive coverage');
  });

  it('says nothing when the target is already met', () => {
    expect(achievableSummary({ ...base, gap: 0, actions: [action(5)] })).toBeNull();
  });

  it('says nothing when there is no target to measure against', () => {
    expect(achievableSummary({ ...base, target: null, gap: null, actions: [action(5)] })).toBeNull();
  });

  it('says nothing when no action carries a measurable gain', () => {
    expect(achievableSummary({ ...base, actions: [action(0)] })).toBeNull();
  });
});

describe('formatHorizon', () => {
  it('reports weeks, because that is how people plan', () => {
    expect(formatHorizon(77)).toBe('11 weeks');
    expect(formatHorizon(7)).toBe('1 week');
  });

  it('distinguishes already-there from unreachable', () => {
    expect(formatHorizon(0)).toBe('already there');
    /* Null means "not from doing nothing" — which is the argument for taking an action, and must
       not be rendered as a duration. */
    expect(formatHorizon(null)).toBeNull();
  });
});

describe('evidenceNote', () => {
  const play = {
    id: 'p',
    title: 't',
    summary: 's',
    steps: ['a'],
    measure: 'm',
    owner: 'support',
    horizon: 'now',
    evidenceStatus: 'none' as const,
    evidence: [] as { title: string; url: string; source: string; relevance: string }[],
  };

  /**
   * A play is not worse for being unevidenced. It is worse for pretending otherwise — a client
   * who catches one invented citation stops believing every number beside it.
   */
  it('says plainly when a play has no source yet', () => {
    const note = evidenceNote(play)!;
    expect(note).toContain('not yet backed');
    expect(note).not.toMatch(/proven|studies show|research/i);
  });

  it('counts real sources when there are any', () => {
    const note = evidenceNote({
      ...play,
      evidenceStatus: 'external',
      evidence: [{ title: 'a', url: 'https://x.test', source: 'y', relevance: 'z' }],
    })!;
    expect(note).toContain('1 published source');
    expect(note).toContain('open to check');
  });

  /* The strongest form available, and the one this product earns on its own. */
  it('prefers the brand’s own measured outcomes when it has them', () => {
    expect(evidenceNote({ ...play, evidenceStatus: 'internal' })!).toContain('your own measured outcomes');
  });

  it('says nothing when there is no play', () => {
    expect(evidenceNote(null)).toBeNull();
  });
});
