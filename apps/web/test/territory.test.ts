import { describe, expect, it } from 'vitest';
import { withTerritory } from '@/lib/brand-data';

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
