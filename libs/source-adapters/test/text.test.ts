import { describe, expect, it } from 'vitest';
import {
  clampContent,
  decodeEntities,
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
