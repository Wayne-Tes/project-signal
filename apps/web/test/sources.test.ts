import { describe, expect, it } from 'vitest';
import { COLLECTING_SOURCES, SOURCE_KEYS, SOURCE_META, sourceMeta } from '../src/config/sources';

/**
 * Source presentation metadata.
 *
 * This replaced a map keyed on display prose ("Google", "News", "X") while the API emits ids
 * (`google_reviews`, `rss`, `x`). Every real id fell through to a default, so glyphs and colours
 * silently degraded to a grey bullet — it looked deliberate and told you nothing.
 */

describe('SOURCE_META', () => {
  it('covers every source the backend models', () => {
    /* Typed as Record<SignalSource, …>, so the compiler enforces this — but the count is
       asserted too, because a source added to the union with a placeholder entry would
       type-check while telling the user nothing. */
    expect(SOURCE_KEYS).toHaveLength(9);
    for (const key of SOURCE_KEYS) {
      expect(SOURCE_META[key].label.length, key).toBeGreaterThan(1);
      expect(SOURCE_META[key].short.length, key).toBeGreaterThan(0);
      expect(SOURCE_META[key].glyph.length, key).toBeGreaterThan(0);
    }
  });

  it('uses tokens, never literal hex — a hex value breaks the palette switcher', () => {
    for (const key of SOURCE_KEYS) {
      expect(SOURCE_META[key].tone, key).toMatch(/^var\(--/);
    }
  });

  it('records which sources actually collect', () => {
    /* KNOWN-GAPS #24: four of the nine are modelled with no adapter behind them. Configuring
       one produces no signals and warns nobody. */
    expect([...COLLECTING_SOURCES].sort()).toEqual(
      ['app_store', 'google_reviews', 'play_store', 'rss', 'youtube'].sort(),
    );
  });
});

describe('sourceMeta', () => {
  it('returns the entry for a known source', () => {
    expect(sourceMeta('google_reviews').short).toBe('Google');
  });

  it('falls back to the raw id for a source this build does not know', () => {
    /* The API can gain a source before the front end is redeployed. Showing the id keeps it
       visible and labelled; an empty chip reads as missing data. */
    const meta = sourceMeta('mastodon');
    expect(meta.label).toBe('mastodon');
    expect(meta.short).toBe('mastodon');
    expect(meta.tone).toMatch(/^var\(--/);
    expect(meta.glyph).toBe('•');
  });
});
