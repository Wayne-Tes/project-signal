import { describe, expect, it } from 'vitest';
import { cx } from '../src/design-system/cx';
import {
  ACCENT_KEYS,
  DEFAULT_APPEARANCE,
  FONT_PAIRS,
  FONT_PAIR_STACK,
  HERO_STYLES,
  accentTintVar,
  accentVar,
  resolveTheme,
} from '../src/design-system/personalisation';

/**
 * Design-system unit tests.
 *
 * These cover the pure logic only. Rendering is not asserted here because the
 * web app has no component-test setup, and adding one is a separate change —
 * `apps/web/e2e` remains the standing gap for anything visual.
 */

describe('cx', () => {
  /**
   * REGRESSION. The class list was built with a template literal whose modifier
   * carried a leading space:
   *
   *   `ds-kpi__value${large ? ' ds-kpi__value--lg' : ''}`
   *
   * The space was lost, producing `ds-kpi__valueds-kpi__value--lg` — one class
   * matching no rule, so the `large` variant silently rendered at normal size.
   * Nothing errored and the type check passed. It reached a commit and survived
   * two attempts to fix it in place, which is why the separator is now the
   * function's responsibility rather than a character in a string.
   */
  it('separates every class with exactly one space', () => {
    expect(cx('ds-kpi__value', 'ds-kpi__value--lg')).toBe('ds-kpi__value ds-kpi__value--lg');
  });

  it('drops falsy parts without leaving stray spaces', () => {
    expect(cx('ds-card', false, undefined, null, 'ds-card--dark')).toBe('ds-card ds-card--dark');
    // The inactive-variant case: a single clean class, no trailing space.
    expect(cx('ds-kpi__value', false && 'ds-kpi__value--lg')).toBe('ds-kpi__value');
  });

  it('returns an empty string when everything is falsy', () => {
    expect(cx(false, null, undefined)).toBe('');
  });
});

describe('accent tokens', () => {
  /**
   * The accent is persisted as a KEY and resolved to a token at apply time, so
   * every key must map to a token that colors.css actually defines. A typo here
   * yields `var(--accent-limee)`, which resolves to nothing and paints the
   * active nav item invisible.
   */
  it('maps every accent key to its solid and tint tokens', () => {
    for (const key of ACCENT_KEYS) {
      expect(accentVar(key)).toBe(`var(--accent-${key})`);
      expect(accentTintVar(key)).toBe(`var(--accent-${key}-tint)`);
    }
  });

  it('offers exactly the five documented accents', () => {
    expect(ACCENT_KEYS).toEqual(['lime', 'blue', 'teal', 'orange', 'purple']);
  });
});

describe('resolveTheme', () => {
  it('passes an explicit choice through unchanged', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('resolves `system` to a real theme rather than leaking the choice', () => {
    // jsdom reports no dark preference, so this is `light` here. The assertion
    // that matters is that `system` never escapes as a paintable value — it is
    // not a valid `data-theme`, and stamping it would produce an unstyled shell.
    expect(['light', 'dark']).toContain(resolveTheme('system'));
  });
});

describe('appearance defaults', () => {
  /**
   * Asserts the WHOLE object rather than individual keys, deliberately. Adding a
   * preference without a default would otherwise pass silently and ship as
   * `undefined` — which for `animate` would mean animations off for everyone.
   * This test failing when a setting is added is the point, not a nuisance.
   */
  it('defaults every setting: system theme, Aurora sidebar, lime, gauge, house type, animated', () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      theme: 'system',
      sidebar: 'light',
      accent: 'lime',
      hero: 'gauge',
      fontPair: 'house',
      animate: true,
    });
  });

  /**
   * REGRESSION. The hero style, typeface pairing and animations toggle were
   * working controls in the prototype Tweaks panel and were removed during the
   * shell migration without being recorded. They are restored as persisted
   * settings; this pins them so a future refactor cannot quietly drop them again.
   */
  it('keeps the controls restored from the Tweaks panel', () => {
    expect(HERO_STYLES).toEqual(['gauge', 'bars']);
    expect(FONT_PAIRS).toEqual(['house', 'grotesk', 'plex', 'sora']);
    // Every pairing must resolve to a real stack — a missing entry would write
    // `undefined` onto --font-display and render the app in the browser default.
    for (const pair of FONT_PAIRS) {
      expect(FONT_PAIR_STACK[pair].display).toMatch(/\S/);
      expect(FONT_PAIR_STACK[pair].body).toMatch(/\S/);
    }
  });
});
