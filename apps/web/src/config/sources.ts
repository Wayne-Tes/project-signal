import type { SignalSource } from '@project-signal/shared-types';

/**
 * Presentation metadata for signal sources.
 *
 * Extracted from `lib/data.ts`, where it sat among the fictional-bank fixture. It does not
 * belong there: a label and a colour for "Google reviews" is real configuration, not mock data,
 * and deleting it with the fixture would have taken working presentation with it.
 *
 * Keyed by the actual `SignalSource` union rather than by the display strings the fixture used
 * ("Google", "News", "X"), so the compiler now enforces that every source the backend can emit
 * has a label — the old map was keyed by prose and silently returned `undefined` for anything
 * the fixture had not thought of.
 *
 * Colours are MOSAIC tokens: categorical, decorative, never semantic. A source is a category,
 * not a status — using the status ramp here would make "YouTube" look like a warning.
 */
export interface SourceMeta {
  /** Full name, for legends and tooltips. */
  label: string;
  /** Short form, for axis labels and chips where space is tight. */
  short: string;
  /** A mosaic token. Never a literal hex — that breaks the palette switcher. */
  tone: string;
  /** Single character shown in the source glyph. A recognisable mark beats an initial. */
  glyph: string;
  /**
   * Whether a collector actually runs for this source.
   *
   * Four of the nine are modelled throughout — type, schema and UI — with no adapter behind
   * them. Configuring one produces no signals and warns nobody, so a user concludes the product
   * is broken. Recording it here lets the UI say so. See KNOWN-GAPS #24.
   */
  collects: boolean;
}

export const SOURCE_META: Record<SignalSource, SourceMeta> = {
  google_reviews: { label: 'Google reviews', short: 'Google', tone: 'var(--tes-mosaic-blue)', glyph: 'G', collects: true },
  app_store: { label: 'App Store', short: 'App Store', tone: 'var(--tes-mosaic-purple)', glyph: '⌘', collects: true },
  play_store: { label: 'Play Store', short: 'Play', tone: 'var(--tes-mosaic-green)', glyph: '▷', collects: true },
  youtube: { label: 'YouTube', short: 'YouTube', tone: 'var(--tes-mosaic-magenta)', glyph: '▶', collects: true },
  rss: { label: 'News / RSS', short: 'RSS', tone: 'var(--tes-mosaic-orange)', glyph: '≡', collects: true },
  reddit: { label: 'Reddit', short: 'Reddit', tone: 'var(--tes-mosaic-vermilion)', glyph: '⬤', collects: true },
  trustpilot: { label: 'Trustpilot', short: 'Trustpilot', tone: 'var(--tes-mosaic-teal)', glyph: '★', collects: false },
  news_api: { label: 'News API', short: 'News', tone: 'var(--tes-mosaic-yellow)', glyph: '⧉', collects: false },
  x: { label: 'X (Twitter)', short: 'X', tone: 'var(--tes-mosaic-indigo)', glyph: '𝕏', collects: false },
  survey: { label: 'Survey', short: 'Survey', tone: 'var(--tes-n-500)', glyph: '✎', collects: false },
};

/** Every source the backend models, in a stable presentation order. */
export const SOURCE_KEYS = Object.keys(SOURCE_META) as SignalSource[];

/** Only the sources that actually produce signals today. */
export const COLLECTING_SOURCES = SOURCE_KEYS.filter((s) => SOURCE_META[s].collects);

/**
 * Metadata for a source id, tolerating one this build does not know.
 *
 * The API can return a source added to the backend before the front end is redeployed. Falling
 * back to the raw id keeps it visible and labelled rather than rendering an empty chip, which
 * reads as missing data rather than as a newer source.
 */
export function sourceMeta(source: string): SourceMeta {
  return (
    SOURCE_META[source as SignalSource] ?? {
      label: source,
      short: source,
      tone: 'var(--tes-n-500)',
      glyph: '•',
      collects: true,
    }
  );
}
