import { describe, expect, it } from 'vitest';
import { buildCitations } from '../../src/assistant/citations.js';

/**
 * Citations.
 *
 * The property under test throughout is that a citation can only describe something that was
 * actually fetched. That is the entire reason this module exists rather than asking the model to
 * emit its own source list — a model that invents a number will invent a matching source, and a
 * citation that cannot be trusted makes a wrong answer more convincing, not less.
 */

describe('buildCitations', () => {
  it('produces nothing when no tool returned anything', () => {
    expect(buildCitations([])).toEqual([]);
  });

  it('cannot cite a tool that was never called', () => {
    /* The structural guarantee, stated as a test. */
    const citations = buildCitations([
      { name: 'search_help', input: {}, data: { articles: [{ slug: 'a', title: 'A', summary: 's', body: 'b' }] } },
    ]);
    expect(citations.every((c) => c.kind === 'help')).toBe(true);
  });

  it('numbers citations sequentially and uniquely', () => {
    const citations = buildCitations([
      {
        name: 'get_brand_impact',
        input: { brandId: 'b1' },
        data: { clusters: [{ topic: 'Delivery delays', volume: 62, damage: 8.4 }, { topic: 'Pricing', volume: 12, damage: 2.1 }] },
      },
    ]);
    expect(citations.map((c) => c.id)).toEqual(['S1', 'S2']);
  });

  it('deduplicates a source the model looked at twice', () => {
    const call = {
      name: 'get_brand_impact',
      input: { brandId: 'b1' },
      data: { clusters: [{ topic: 'Delivery delays', volume: 62, damage: 8.4 }] },
    };
    expect(buildCitations([call, call])).toHaveLength(1);
  });

  it('links a help citation to the article it came from', () => {
    const [citation] = buildCitations([
      {
        name: 'search_help',
        input: {},
        data: { articles: [{ slug: 'how-recency-works', title: 'How recency works', summary: 'Decay.', body: 'x' }] },
      },
    ]);
    expect(citation).toMatchObject({ kind: 'help', href: '/help/how-recency-works' });
  });

  it('reports an unscored brand as unscored, never as zero', () => {
    /* The single most damaging thing this product could say. An absent rollup means "not
       scored"; zero would mean uniformly negative sentiment, which is a different claim about
       a real business. */
    const [citation] = buildCitations([
      { name: 'get_brand_score', input: { brandId: 'b1' }, data: {} },
    ]);
    expect(citation?.detail).toBe('not scored yet');
    expect(citation?.detail).not.toContain('0');
  });

  it('carries the actual score when there is one', () => {
    const [citation] = buildCitations([
      { name: 'get_brand_score', input: { brandId: 'b1' }, data: { score: 62.35 } },
    ]);
    expect(citation?.detail).toBe('62.4');
  });

  it('renders a whole number without a pointless decimal', () => {
    const [citation] = buildCitations([
      { name: 'get_brand_score', input: { brandId: 'b1' }, data: { score: 62 } },
    ]);
    expect(citation?.detail).toBe('62');
  });

  it('cites one entry per dimension rather than one per data point', () => {
    /* A 90-day history is hundreds of rows. A citation list nobody can read is the same as no
       citation list. */
    const scores = [];
    for (let day = 1; day <= 30; day += 1) {
      for (const dimension of ['trust', 'quality', 'service', 'value', 'experience']) {
        scores.push({ dimension, score: 50 + day, date: `2026-07-${String(day).padStart(2, '0')}` });
      }
    }
    const citations = buildCitations([
      { name: 'get_dimension_scores', input: { brandId: 'b1' }, data: { scores } },
    ]);
    expect(citations).toHaveLength(5);
    /* And it must be the LATEST value, not whichever row happened to come first. */
    expect(citations[0]?.detail).toContain('2026-07-30');
  });

  it('points a signal citation at where it was actually published', () => {
    /* The external URL is the honest destination: it is what lets a user verify a quotation
       themselves rather than taking the product's word for it. */
    const [citation] = buildCitations([
      {
        name: 'get_signals',
        input: { brandId: 'b1' },
        data: {
          signals: [
            { id: 'sig-1', source: 'rss', publishedAt: '2026-08-01T10:00:00.000Z', sourceUrl: 'https://example.com/a' },
          ],
        },
      },
    ]);
    expect(citation).toMatchObject({ kind: 'signal', href: 'https://example.com/a' });
  });

  it('identifies a signal by source and date rather than by a raw uuid', () => {
    const [citation] = buildCitations([
      {
        name: 'get_signals',
        input: { brandId: 'b1' },
        data: { signals: [{ id: 'ac85dc3d-e6ea-473c-803f-eac99157a0ec', source: 'rss', publishedAt: '2026-08-01T10:00:00.000Z' }] },
      },
    ]);
    expect(citation?.title).toBe('rss · 2026-08-01');
  });

  it('skips a malformed record rather than emitting an empty citation', () => {
    const citations = buildCitations([
      {
        name: 'get_signals',
        input: { brandId: 'b1' },
        data: { signals: [{ source: 'rss' }, null, 'nonsense', { id: 'ok', source: 'rss', publishedAt: '2026-08-01' }] },
      },
    ]);
    expect(citations).toHaveLength(1);
  });

  it('survives a tool result of an entirely unexpected shape', () => {
    /* Defensive because these shapes come from routes that can change. A citation builder that
       throws takes down an answer the user was going to get. */
    expect(() =>
      buildCitations([
        { name: 'get_brand_impact', input: {}, data: null },
        { name: 'get_dimension_scores', input: {}, data: 'not an object' },
        { name: 'get_signals', input: {}, data: 42 },
        { name: 'unknown_tool', input: {}, data: { anything: true } },
      ]),
    ).not.toThrow();
  });

  it('labels a strengths cluster by strength, not by damage', () => {
    const [citation] = buildCitations([
      {
        name: 'get_strengths',
        input: { brandId: 'b1' },
        data: { clusters: [{ topic: 'Support quality', volume: 30, strength: 5.5, damage: 0.1 }] },
      },
    ]);
    expect(citation?.detail).toContain('strength 5.5');
    expect(citation?.detail).not.toContain('damage');
  });
});
