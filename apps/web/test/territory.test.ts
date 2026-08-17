import { describe, expect, it } from 'vitest';
import { emptyScoreMessage, withTerritory } from '@/lib/brand-data';

/**
 * Every view builds its territory query through this one helper.
 *
 * Two views constructing the query differently is how a dashboard comes to show a UK headline
 * above an all-territories breakdown — both plausible, silently disagreeing, and invisible
 * without reading the network tab.
 */
describe('withTerritory', () => {
  it('adds the parameter when a territory is selected', () => {
    expect(withTerritory('/brands/b1/score', 'GB')).toBe('/brands/b1/score?territory=GB');
  });

  it('appends with & when the path already has a query', () => {
    expect(withTerritory('/brands/b1/whats-new?days=7', 'AU')).toBe(
      '/brands/b1/whats-new?days=7&territory=AU',
    );
  });

  /**
   * `all` produces NO parameter, rather than `territory=all`.
   *
   * On `dimension_scores` the API treats a missing value as the aggregate, so the two agree
   * there. On `signals` they do not: no signal carries `'all'`, so filtering for it returns
   * nothing — an empty drill-down under a populated score, with no error. Omitting it keeps one
   * meaning across both.
   */
  it('omits the parameter entirely for the aggregate', () => {
    expect(withTerritory('/brands/b1/score', 'all')).toBe('/brands/b1/score');
    expect(withTerritory('/brands/b1/whats-new?days=7', 'all')).toBe('/brands/b1/whats-new?days=7');
  });

  it('omits it when nothing is selected', () => {
    expect(withTerritory('/brands/b1/score', undefined)).toBe('/brands/b1/score');
    expect(withTerritory('/brands/b1/score', '')).toBe('/brands/b1/score');
  });

  it('encodes the value rather than interpolating it raw', () => {
    /* Territory reaches this from context, but the rule is the same as everywhere else in this
       codebase: a value that ends up in a URL is encoded at the point it is put there. */
    expect(withTerritory('/brands/b1/score', 'a b&c')).toBe('/brands/b1/score?territory=a%20b%26c');
  });
});

/**
 * The empty-score message.
 *
 * Found by driving the deployed app rather than by a test: selecting "United Kingdom" rendered
 * "the daily rollup has not scored it", which is FALSE — the brand is scored, that territory is
 * not. A plausible message pointing at the wrong cause sends someone to raise a support ticket
 * about a system that is working correctly, which is worse than a vague message.
 */
describe('emptyScoreMessage', () => {
  it('blames the pipeline only when no territory is selected', () => {
    const msg = emptyScoreMessage('all');
    expect(msg).toContain('daily rollup has not scored it');
    expect(emptyScoreMessage(undefined)).toBe(msg);
  });

  it('names the territory, and says the brand may still be scored overall', () => {
    const msg = emptyScoreMessage('GB');
    expect(msg).toContain('the United Kingdom');
    expect(msg).toContain('All territories');
    /* Must NOT repeat the pipeline claim — that is the false statement being fixed. */
    expect(msg).not.toContain('daily rollup has not scored it');
  });

  it('reads naturally for the sentinels rather than printing a raw code', () => {
    expect(emptyScoreMessage('GLOBAL')).toContain('global channels');
    expect(emptyScoreMessage('unknown')).toContain('unclassified feeds');
  });

  it('falls back to the code rather than throwing on an unrecognised value', () => {
    expect(emptyScoreMessage('ZZ')).toContain('ZZ');
  });
});
