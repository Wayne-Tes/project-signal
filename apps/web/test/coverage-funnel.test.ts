import { describe, expect, it } from 'vitest';
import { coverageFooter, coverageTone } from '@/lib/brand-data';

/**
 * The coverage funnel: collected → scored → classified → rolled up.
 *
 * Each arrow can silently drop a signal, and the dashboard used to report only the first one
 * (`scoredSignals / totalSignals`). That reads as healthy in the exact case that matters: a
 * brand whose signals are all scored but tagged to no dimension reaches no index, no cluster and
 * no drill-down, and produces no rollup rows at all. Two brands sat in that state for weeks and
 * the product never said so — the owner found it.
 *
 * These tests pin the distinctions, because "0%" means four different things and only one of
 * them is a defect.
 */
describe('coverageFooter', () => {
  const base = {
    signalsThisWeek: 0,
    signalsPreviousWeek: 0,
    totalSignals: 100,
    scoredSignals: 100,
    classifiedSignals: 100,
    lastRollupDate: '2026-08-16',
    activeSources: 2,
    configuredSources: 2,
  };

  it('distinguishes "nothing collected" from every kind of failure', () => {
    expect(coverageFooter({ ...base, totalSignals: 0 })).toContain('nothing collected');
    expect(coverageFooter(null)).toContain('nothing collected');
    expect(coverageFooter(undefined)).toContain('nothing collected');
  });

  it('names scoring as the stalled stage when nothing has been scored', () => {
    const footer = coverageFooter({ ...base, scoredSignals: 0, classifiedSignals: 0 });
    expect(footer).toContain('none scored');
  });

  /* The defect this whole funnel exists for. Scored — so the old footer read "100 of 100
     scored", which is true and completely misleading — but tagged to no dimension, so none of
     it reaches the index. */
  it('names classification as the stalled stage when nothing is tagged to a dimension', () => {
    const footer = coverageFooter({ ...base, classifiedSignals: 0 });
    expect(footer).toContain('none tagged to a dimension');
    expect(footer).not.toContain('in the index');
  });

  it('names the rollup as the stalled stage when it has never run', () => {
    const footer = coverageFooter({ ...base, lastRollupDate: null });
    expect(footer).toContain('no rollup has run');
  });

  it('reports the healthy case as a share of the index, not of scoring', () => {
    expect(coverageFooter(base)).toBe('100 of 100 in the index');
  });

  it('calls out a scoring backlog without treating it as a fault', () => {
    const footer = coverageFooter({ ...base, scoredSignals: 80, classifiedSignals: 80 });
    expect(footer).toContain('80 of 100 in the index');
    expect(footer).toContain('20 awaiting scoring');
  });

  it('calls out signals scored into no dimension when scoring itself is complete', () => {
    const footer = coverageFooter({ ...base, classifiedSignals: 90 });
    expect(footer).toContain('10 scored into no dimension');
  });
});

describe('coverageTone', () => {
  const base = {
    signalsThisWeek: 0,
    signalsPreviousWeek: 0,
    totalSignals: 100,
    scoredSignals: 100,
    classifiedSignals: 100,
    lastRollupDate: '2026-08-16',
    activeSources: 2,
    configuredSources: 2,
  };

  /* A brand with nothing collected is new, not broken. Colouring it as an alarm would train
     people to ignore the colour — the same reason the anomaly banner was removed. */
  it('does not alarm on a brand that has collected nothing', () => {
    expect(coverageTone({ ...base, totalSignals: 0, scoredSignals: 0, classifiedSignals: 0 })).toBe(
      'var(--t1)',
    );
  });

  it('alarms when signals are scored but none reach a dimension', () => {
    expect(coverageTone({ ...base, classifiedSignals: 0 })).toBe('var(--coral)');
  });

  it('alarms when classified signals exist but no rollup has ever run', () => {
    expect(coverageTone({ ...base, lastRollupDate: null })).toBe('var(--coral)');
  });

  it('is calm when the funnel is delivering', () => {
    expect(coverageTone(base)).toBe('var(--t1)');
  });

  /* Every value is a custom property. A literal hex here would survive every test and then break
     the runtime palette switcher in the light theme — KNOWN-GAPS #19 and #20. */
  it('only ever returns design tokens', () => {
    const cases = [
      base,
      { ...base, classifiedSignals: 0 },
      { ...base, lastRollupDate: null },
      { ...base, totalSignals: 0 },
    ];
    for (const c of cases) expect(coverageTone(c)).toMatch(/^var\(--[a-z0-9-]+\)$/);
  });
});
