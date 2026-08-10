/**
 * Turning source markup into text a person can read.
 *
 * WHY THIS EXISTS. Every adapter hands `RawItem.text` to two consumers: the sentiment scorer, and
 * — from now on — the drill-down, where a marketing manager reads it. Both were being given raw
 * markup.
 *
 * The Google News RSS feed is the worst case and it is 225 of this tenant's 228 signals. Its
 * `<description>` is not a description at all; it is a link element:
 *
 *   <a href="https://news.google.com/rss/articles/CBMiqgFBVV95cUxQ…?oc=5">A better way to help
 *   pupils engage with global crises</a>
 *
 * So the scorer has been assigning trust, quality and experience scores to an HTML anchor tag
 * wrapped around a headline, and the URL inside it is longer than the sentence. That is both a
 * scoring-quality defect and, once the text is shown in the UI, a visible one.
 *
 * Stripping happens in the ADAPTER rather than at render time on purpose. The scorer must see the
 * same words the user sees, or the two disagree about what was assessed. The verbatim payload is
 * still written to S3 untouched, so the audit trail keeps the original markup.
 */

/** The handful of named entities that actually appear in feed text. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

/** `&amp;` → `&`, `&#39;` → `'`, `&#x2019;` → `’`. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number): string {
  /* An out-of-range code point throws from String.fromCodePoint, which would fail an entire
     collection run over one malformed entity in one item. */
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  return String.fromCodePoint(code);
}

/**
 * Markup in, readable prose out.
 *
 * `<br>`, `</p>` and `</div>` become newlines rather than vanishing, because a review written in
 * paragraphs is unreadable once they are concatenated into one run-on line — and reviews are
 * exactly what this renders.
 */
export function stripHtml(value: string): string {
  return decodeEntities(
    value
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    /* Collapse runs of blank lines, and trailing spaces on each line, without flattening the
       paragraph breaks just introduced. */
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A headline and a body, joined only when the headline adds something.
 *
 * App Store and Play Store reviews carry most of their sentiment in the title — "Constant
 * crashes" over three paragraphs of detail — so dropping it loses the strongest signal in the
 * item. But a Google News RSS entry's "body" IS its headline, and naively joining them yields the
 * same sentence twice, which reads like a rendering bug and doubles its weight to the scorer.
 */
export function joinTitleAndBody(title: string | undefined, body: string | undefined): string {
  const t = (title ?? '').trim();
  const b = (body ?? '').trim();
  if (!t) return b;
  if (!b) return t;

  /**
   * Compared on WORDS ONLY — every non-alphanumeric character becomes a space.
   *
   * A gentler normalisation (lower-case, collapse whitespace, drop a trailing full stop) was not
   * enough, and the deployed page proved it. Google News gave:
   *
   *   title:       "… Digital Infrastructure Report - Yahoo Finance UK"
   *   description: "… Digital Infrastructure Report Yahoo Finance UK"
   *
   * One hyphen apart. Neither string contained the other, so they were treated as different text
   * and concatenated, and the drill-down printed the headline twice. Comparing on words removes
   * every variant of this — hyphens, em dashes, pipes, colons, smart quotes — instead of chasing
   * them one at a time.
   */
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const nt = norm(t);
  const nb = norm(b);

  /**
   * Collapse when the two are NEARLY the same string, not merely when one appears inside the
   * other.
   *
   * A strict `startsWith` was not enough. Google News sets `<title>` to
   * "SK Tes Ireland Achieves ISO Certification Milestone — Yahoo Finance UK" and its description
   * to the same headline WITHOUT the publisher suffix, so neither was a prefix of the other and
   * the drill-down rendered the sentence twice, one line apart. It looked like a rendering bug
   * because it was one.
   *
   * The 80% length ratio is what keeps this from eating real reviews. A review titled "Constant
   * crashes" whose body mentions "the constant crashes are infuriating" contains the title, but
   * the title is a small fraction of the body — so the title is kept, which is right, because it
   * carries the sentiment.
   */
  const shorter = nt.length <= nb.length ? nt : nb;
  const longer = nt.length <= nb.length ? nb : nt;

  /* A pure PREFIX adds nothing: "Tes launches" ahead of "Tes launches a new marking tool" is the
     same sentence truncated, and printing both is the duplication this function exists to stop. */
  const isTruncation = longer.startsWith(shorter);
  /* Otherwise require near-identity by length. "Constant crashes" is CONTAINED in "The constant
     crashes make it unusable…" but is only a fifth of it, and that title carries the review's
     sentiment — collapsing there would discard the strongest signal in the item. */
  const nearlyIdentical = longer.includes(shorter) && shorter.length / longer.length >= 0.8;

  if (isTruncation || nearlyIdentical) return b.length >= t.length ? b : t;

  return `${t}\n\n${b}`;
}

/** Trims to a sane column width for storage. Reviews are short; a scraped article body is not. */
export const MAX_CONTENT_LENGTH = 20_000;

export function clampContent(value: string): string {
  return value.length <= MAX_CONTENT_LENGTH ? value : `${value.slice(0, MAX_CONTENT_LENGTH)}…`;
}
