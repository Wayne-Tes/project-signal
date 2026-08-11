import { describe, expect, it } from 'vitest';
import {
  clampContent,
  decodeEntities,
  dedupeParagraphs,
  joinTitleAndBody,
  MAX_CONTENT_LENGTH,
  stripHtml,
} from '../src/text.js';

/**
 * Turning source markup into text a person can read.
 *
 * THE DEFECT THIS CLOSES, with the real payload. 225 of this tenant's 228 signals came from
 * Google News RSS, whose `<description>` is not a description — it is an anchor element wrapping
 * the headline, with a tracking URL longer than the sentence. That string was handed straight to
 * the sentiment scorer AND is now shown to a marketing manager in the drill-down. So the scorer
 * was assigning trust and quality scores partly to HTML, and the UI would have rendered a tag.
 */

/** Verbatim from a real Google News RSS item collected 2026-08-09. */
const GOOGLE_NEWS_DESCRIPTION =
  '<a href="https://news.google.com/rss/articles/CBMiqgFBVV95cUxQM2dBRmR1VE9KLU5IRkoyQWJFWEtCWE80ZXRfYVBQZU82YVBTb0xCUmRjMEdPYktzV21oR19uYXJaRlpnNFl3N2diZ0JmSmd4UmRIeURwaVU3N0dCTzFBcDRyREFGZF9rbU1qWjlFX3p2bFoxdy1PUkppcUFBbHAzTGRENW8yUWxpdFpCX1BIRlREakFTZ1lYampQdGV6cUdyN3RfN2JHWFhXZw?oc=5" target="_blank">A better way to help pupils engage with global crises</a>&nbsp;&nbsp;<font color="#6f6f6f">Tes</font>';

describe('stripHtml', () => {
  it('reduces the real Google News payload to the headline', () => {
    const out = stripHtml(GOOGLE_NEWS_DESCRIPTION);

    expect(out).toContain('A better way to help pupils engage with global crises');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('href');
    /* The tracking URL is the bulk of the original string and none of its meaning. */
    expect(out).not.toContain('news.google.com');
    expect(out.length).toBeLessThan(80);
  });

  it('keeps paragraph structure instead of running it together', () => {
    /* A three-paragraph review collapsed into one line is technically the same words and
       practically unreadable — and reviews are exactly what this renders. */
    const out = stripHtml('<p>First point.</p><p>Second point.</p>');
    expect(out).toBe('First point.\nSecond point.');
  });

  it('turns <br> into a line break rather than deleting it', () => {
    expect(stripHtml('one<br/>two')).toBe('one\ntwo');
  });

  it('discards script and style content entirely', () => {
    /* Their bodies are not words anybody said; scoring them is noise and rendering them is a
       defect. */
    const out = stripHtml('<style>.a{color:red}</style>Real text<script>alert(1)</script>');
    expect(out).toBe('Real text');
  });

  it('collapses runaway blank lines', () => {
    expect(stripHtml('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('leaves plain text untouched', () => {
    expect(stripHtml('Just a normal review, nothing special.')).toBe(
      'Just a normal review, nothing special.',
    );
  });

  it('returns empty for markup with no text in it', () => {
    expect(stripHtml('<div><span></span></div>')).toBe('');
  });
});

describe('decodeEntities', () => {
  it('decodes the named entities feeds actually use', () => {
    expect(decodeEntities('Tes &amp; friends &nbsp;&mdash; &quot;quoted&quot;')).toBe(
      'Tes & friends  — "quoted"',
    );
  });

  it('decodes numeric and hex references', () => {
    expect(decodeEntities('it&#39;s &#x2019;s')).toBe("it's ’s");
  });

  it('leaves an unknown entity alone rather than mangling it', () => {
    expect(decodeEntities('&notarealentity; stays')).toBe('&notarealentity; stays');
  });

  it('survives an out-of-range code point without throwing', () => {
    /* String.fromCodePoint throws on these, which would fail an entire collection run over one
       malformed entity in one item. */
    expect(() => decodeEntities('&#99999999;')).not.toThrow();
  });
});

describe('joinTitleAndBody', () => {
  it('keeps the title, which carries most of a review’s sentiment', () => {
    /* "Constant crashes" over three paragraphs of detail — scoring only the body loses the
       strongest signal in the item. */
    expect(joinTitleAndBody('Constant crashes', 'It closes whenever I open a class.')).toBe(
      'Constant crashes\n\nIt closes whenever I open a class.',
    );
  });

  it('does NOT repeat a headline that is also the body', () => {
    /* The normal case for Google News, where description and title are the same sentence.
       Concatenating reads as a rendering bug and doubles the item's weight to the scorer. */
    const headline = 'A better way to help pupils engage with global crises';
    expect(joinTitleAndBody(headline, headline)).toBe(headline);
  });

  it('ignores case and trailing ellipsis when deciding they are the same', () => {
    expect(joinTitleAndBody('Tes launches new tool', 'TES launches new tool…')).toBe(
      'TES launches new tool…',
    );
  });

  it('prefers the longer of the two when one is a truncation of the other', () => {
    expect(joinTitleAndBody('Tes launches', 'Tes launches a new marking tool')).toBe(
      'Tes launches a new marking tool',
    );
  });

  it('returns whichever side exists when the other is missing', () => {
    expect(joinTitleAndBody(undefined, 'body only')).toBe('body only');
    expect(joinTitleAndBody('title only', undefined)).toBe('title only');
    expect(joinTitleAndBody(undefined, undefined)).toBe('');
  });

  it('treats whitespace-only as absent', () => {
    expect(joinTitleAndBody('   ', 'real body')).toBe('real body');
  });
});

describe('clampContent', () => {
  it('leaves ordinary review-length text alone', () => {
    const review = 'a'.repeat(500);
    expect(clampContent(review)).toBe(review);
  });

  it('truncates a scraped article body and marks that it was cut', () => {
    const clamped = clampContent('a'.repeat(MAX_CONTENT_LENGTH + 5_000));
    expect(clamped).toHaveLength(MAX_CONTENT_LENGTH + 1);
    expect(clamped.endsWith('…')).toBe(true);
  });

  it('does not append an ellipsis to text exactly at the limit', () => {
    const exact = 'a'.repeat(MAX_CONTENT_LENGTH);
    expect(clampContent(exact)).toBe(exact);
  });
});

/**
 * The near-duplicate case, found by LOOKING at the deployed drill-down rather than by a test.
 *
 * Google News sets `<title>` to the headline plus the publisher — "… Report - Yahoo Finance UK" —
 * and its description to the same headline without that suffix. Neither string was a prefix of
 * the other, so the original strict comparison joined them, and the panel rendered the same
 * sentence twice, one line apart. It read as a broken component because it was one.
 */
describe('headlines that are nearly, but not exactly, the body', () => {
  const HEADLINE = 'SK Tes Ireland Achieves ISO Certification Milestone and Recognized in National Digital Infrastructure Report';

  it('collapses a title that differs only by a publisher suffix', () => {
    const out = joinTitleAndBody(`${HEADLINE} - Yahoo Finance UK`, HEADLINE);
    expect(out.split('ISO Certification').length - 1).toBe(1);
  });

  it('collapses when the difference is only punctuation', () => {
    expect(joinTitleAndBody('Tes launches a new tool.', 'Tes launches a new tool')).toBe(
      'Tes launches a new tool.',
    );
  });

  it('KEEPS a short review title even though the body mentions it', () => {
    /* The case the 80% length ratio protects. "Constant crashes" carries the sentiment of the
       review and appears inside the body — collapsing here would throw away the strongest signal
       in the item, which is the opposite of the intent. */
    const out = joinTitleAndBody(
      'Constant crashes',
      'The constant crashes make it unusable during a lesson, and support have not replied in two weeks.',
    );
    expect(out).toContain('Constant crashes\n\n');
    expect(out).toContain('support have not replied');
  });

  it('keeps two genuinely different sentences', () => {
    const out = joinTitleAndBody('Great for planning', 'Support is slow but the app is reliable.');
    expect(out).toBe('Great for planning\n\nSupport is slow but the app is reliable.');
  });
});

/**
 * The exact pair that defeated the FIRST attempt at this fix.
 *
 * Worth pinning verbatim rather than paraphrasing. After deploying a "collapse near-identical
 * strings" rule, the drill-down still printed this headline twice — because the two differ by a
 * single hyphen, so neither contained the other and the containment check never fired.
 *
 * Worse, the script written to verify the fix used the SAME normalisation as the code, so it
 * reported "0 duplicates" against data that was visibly duplicated. The lesson is in the test:
 * comparison must be on words, and a checker that shares the code's assumptions checks nothing.
 */
describe('the hyphen that broke the first fix', () => {
  const TITLE =
    'SK Tes Ireland Achieves ISO Certification Milestone and Recognized in National Digital Infrastructure Report - Yahoo Finance UK';
  const BODY =
    'SK Tes Ireland Achieves ISO Certification Milestone and Recognized in National Digital Infrastructure Report Yahoo Finance UK';

  it('collapses them to a single paragraph', () => {
    const out = joinTitleAndBody(TITLE, BODY);
    expect(out).not.toContain('\n\n');
    expect(out.split('ISO Certification').length - 1).toBe(1);
  });

  it('is unmoved by any of the separators feeds use', () => {
    for (const sep of [' - ', ' — ', ' | ', ': ', ' – ']) {
      const out = joinTitleAndBody(`Tes wins award${sep}Yahoo Finance UK`, 'Tes wins award Yahoo Finance UK');
      expect(out, `separator "${sep}"`).not.toContain('\n\n');
    }
  });

  it('still keeps two genuinely different sentences apart', () => {
    /* The guard against over-collapsing: punctuation-insensitivity must not make everything look
       the same. */
    const out = joinTitleAndBody('Great for planning', 'Support is slow but the app is reliable.');
    expect(out).toContain('\n\n');
  });
});

/**
 * Idempotence — the property that turned out to matter more than the specific bug.
 *
 * The raw S3 payload is written on every collection run under a key derived from the item's
 * external id, so re-collecting an item OVERWRITES its object with whatever `RawItem.text` holds
 * at that moment. Once the joining logic shipped, that value was the already-joined
 * title-plus-body — and the "untouched raw payload" stopped being untouched.
 *
 * The backfill therefore could not repair the data, because the thing it re-derived FROM had
 * itself been rewritten. Deduplicating paragraphs makes re-processing converge instead of
 * compound, which is what stops a future normalisation change corrupting what it re-reads.
 */
describe('dedupeParagraphs', () => {
  it('repairs text that was already joined once', () => {
    /* The exact stored payload, read out of S3 on 2026-08-11. */
    const stored =
      'A better way to help pupils engage with global crises - Tes\n\nA better way to help pupils engage with global crises Tes';
    const out = dedupeParagraphs(stored);
    expect(out.split('\n\n')).toHaveLength(1);
    expect(out).toContain('A better way to help pupils engage with global crises');
  });

  it('makes joinTitleAndBody idempotent', () => {
    const once = joinTitleAndBody('Constant crashes', 'It closes whenever I open a class.');
    const twice = joinTitleAndBody('Constant crashes', once);
    expect(twice).toBe(once);
  });

  it('keeps the fuller wording of two near-identical paragraphs', () => {
    const out = dedupeParagraphs('Tes wins award\n\nTes wins award for teaching resources');
    expect(out).toBe('Tes wins award for teaching resources');
  });

  it('leaves genuinely different paragraphs alone', () => {
    const text = 'The app crashes constantly.\n\nSupport have not replied in two weeks.';
    expect(dedupeParagraphs(text)).toBe(text);
  });

  it('only compares ADJACENT paragraphs', () => {
    /* A review that returns to an earlier point later on is making that point twice on purpose. */
    const text = 'It crashes.\n\nSupport is slow.\n\nIt crashes.';
    expect(dedupeParagraphs(text).split('\n\n')).toHaveLength(3);
  });

  it('passes single-paragraph text straight through', () => {
    expect(dedupeParagraphs('Just one thing to say.')).toBe('Just one thing to say.');
  });
});
