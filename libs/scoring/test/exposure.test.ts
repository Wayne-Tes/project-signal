import { describe, expect, it } from 'vitest';
import { corroborate, rankByExposure, type ExposureItem } from '../src/exposure.js';

const item = (over: Partial<ExposureItem> & { topic: string }): ExposureItem => ({
  accountId: 'a1',
  arrBand: '10-50k',
  score: -0.5,
  ...over,
});

describe('rankByExposure', () => {
  /**
   * The whole reason this exists. Every other view ranks by volume, and for public signals that
   * is right. Here it would bury one renewal-risk note from a 250k+ account under a subject fifty
   * small accounts mentioned in passing.
   */
  it('ranks one large account above many small ones', () => {
    const ranked = rankByExposure([
      item({ topic: 'big risk', accountId: 'whale', arrBand: '250k+' }),
      ...Array.from({ length: 6 }, (_, i) =>
        item({ topic: 'small gripe', accountId: `s${i}`, arrBand: '<10k' }),
      ),
    ]);
    expect(ranked[0]!.topic).toBe('big risk');
    expect(ranked[0]!.accounts).toBe(1);
  });

  /**
   * Ten notes about one unhappy customer is one unhappy customer. Counting mentions would rank
   * the note-taking habits of the account team as much as the customers' views.
   */
  it('counts distinct accounts, not interactions', () => {
    const ranked = rankByExposure([
      ...Array.from({ length: 10 }, () => item({ topic: 'chatty', accountId: 'same' })),
      item({ topic: 'quiet', accountId: 'x1' }),
      item({ topic: 'quiet', accountId: 'x2' }),
    ]);
    const chatty = ranked.find((r) => r.topic === 'chatty')!;
    expect(chatty.accounts).toBe(1);
    expect(chatty.mentions).toBe(10);
    /* Two accounts outrank one, however much the one talks. */
    expect(ranked[0]!.topic).toBe('quiet');
  });

  /* "Nobody filled in the CRM field" is not a reason to hide what a customer said. */
  it('still counts an account with no band', () => {
    const ranked = rankByExposure([item({ topic: 'unbanded', arrBand: null })]);
    expect(ranked[0]!.accounts).toBe(1);
    expect(ranked[0]!.exposure).toBeGreaterThan(0);
    expect(ranked[0]!.topBand).toBeNull();
  });

  /* We know somebody said it; we do not know who. Counting it as an account would invent one. */
  it('records an unmatched interaction as a mention but not as an account', () => {
    const ranked = rankByExposure([item({ topic: 'orphan', accountId: null })]);
    expect(ranked[0]!.mentions).toBe(1);
    expect(ranked[0]!.accounts).toBe(0);
  });

  it('surfaces the largest affected account so one whale is visible', () => {
    const ranked = rankByExposure([
      item({ topic: 't', accountId: 'a', arrBand: '<10k' }),
      item({ topic: 't', accountId: 'b', arrBand: '250k+' }),
    ]);
    expect(ranked[0]!.topBand).toBe('250k+');
  });

  it('breaks ties by which is going worse', () => {
    const ranked = rankByExposure([
      item({ topic: 'mild', accountId: 'a', score: -0.1 }),
      item({ topic: 'severe', accountId: 'b', score: -0.9 }),
    ]);
    expect(ranked[0]!.topic).toBe('severe');
  });
});

describe('corroborate', () => {
  /**
   * The one finding neither channel can produce alone. Two populations who did not speak to each
   * other reporting the same complaint is as close to proof as this product gets.
   */
  it('surfaces subjects raised both publicly and privately', () => {
    const out = corroborate(
      [
        { topic: 'pricing', score: -0.6 },
        { topic: 'pricing', score: -0.4 },
        { topic: 'design', score: 0.8 },
      ],
      [item({ topic: 'pricing', accountId: 'a1' }), item({ topic: 'onboarding', accountId: 'a2' })],
    );

    expect(out.map((c) => c.topic)).toEqual(['pricing']);
    expect(out[0]!.publicVolume).toBe(2);
    expect(out[0]!.accounts).toBe(1);
  });

  it('reports each side’s sentiment separately, because they often differ', () => {
    const out = corroborate(
      [{ topic: 'pricing', score: -0.2 }],
      [item({ topic: 'pricing', score: -0.9 })],
    );
    expect(out[0]!.publicSentiment).toBeCloseTo(-0.2);
    expect(out[0]!.reportedSentiment).toBeCloseTo(-0.9);
  });

  it('reports nothing when the channels do not overlap', () => {
    expect(corroborate([{ topic: 'a', score: 0 }], [item({ topic: 'b' })])).toHaveLength(0);
  });

  /**
   * Matching is exact on the normalised tag. Fuzzy matching was rejected: a FALSE corroboration
   * is far more damaging than a missed one, because the entire value of the claim is that two
   * independent sources agree.
   */
  it('does not claim corroboration on a near-match', () => {
    expect(corroborate([{ topic: 'pricing', score: -0.5 }], [item({ topic: 'price' })])).toHaveLength(0);
  });

  it('leads with the subject most visible in public', () => {
    const out = corroborate(
      [
        { topic: 'loud', score: -0.5 },
        { topic: 'loud', score: -0.5 },
        { topic: 'loud', score: -0.5 },
        { topic: 'quiet', score: -0.5 },
      ],
      [item({ topic: 'loud', accountId: 'a' }), item({ topic: 'quiet', accountId: 'b' })],
    );
    expect(out[0]!.topic).toBe('loud');
  });
});
