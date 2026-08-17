import { describe, expect, it } from 'vitest';
import { PLAYS, bestPlayFor, playById, playsFor, type MatchableCluster } from '../src/index.js';

const cluster = (over: Partial<MatchableCluster> = {}): MatchableCluster => ({
  topic: 'pricing',
  volume: 5,
  sentiment: -0.5,
  dimensions: ['value'],
  ...over,
});

/**
 * THE RULE THAT KEEPS THE LIBRARY HONEST.
 *
 * A play may ship unevidenced — most do, and saying so is fine. What it may never do is claim
 * evidence it has not got. Fabricating a plausible citation is the failure this codebase has
 * already paid for twice with model ids, and a client can check a citation.
 */
describe('the evidence rule', () => {
  it('never claims external evidence without a citation to back it', () => {
    for (const play of PLAYS) {
      if (play.evidenceStatus === 'external') {
        expect(play.evidence.length, `${play.id} claims external evidence with none attached`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('never attaches a citation without a URL a reader can open', () => {
    for (const play of PLAYS) {
      for (const c of play.evidence) {
        expect(c.url, `${play.id} has a citation with no URL`).toMatch(/^https?:\/\//);
        /* Forces whoever added it to state the connection — where a weak citation shows itself. */
        expect(c.relevance.length, `${play.id} has a citation with no relevance note`).toBeGreaterThan(0);
      }
    }
  });

  it('carries no citations while it is marked unevidenced', () => {
    for (const play of PLAYS) {
      if (play.evidenceStatus === 'none') {
        expect(play.evidence, `${play.id} is marked unevidenced but has citations`).toHaveLength(0);
      }
    }
  });
});

describe('play quality', () => {
  it('gives every play a stable id, and no duplicates', () => {
    const ids = PLAYS.map((p) => p.id);
    /* Ids are referenced by tracked_actions, so a duplicate or a rename orphans real history. */
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every play concrete steps and a measure', () => {
    for (const play of PLAYS) {
      expect(play.steps.length, `${play.id} has no steps`).toBeGreaterThan(0);
      expect(play.measure.length, `${play.id} has no measure`).toBeGreaterThan(0);
    }
  });

  /* A step you cannot put in a meeting invitation is advice about advice. */
  it('avoids steps that merely restate the goal', () => {
    const vague = /^(improve|increase|enhance|optimi[sz]e|boost) (customer |brand |user )?(sentiment|perception|satisfaction)\b/i;
    for (const play of PLAYS) {
      for (const step of play.steps) {
        expect(vague.test(step.trim()), `${play.id}: "${step}" restates the goal`).toBe(false);
      }
    }
  });
});

describe('matching', () => {
  it('matches a pricing complaint to the pricing play', () => {
    expect(bestPlayFor(cluster())?.id).toBe('explain-the-price');
  });

  it('matches a crash complaint on wording, not only on tags', () => {
    const best = bestPlayFor(cluster({ topic: 'app crashes', dimensions: ['quality'], sentiment: -0.6 }));
    expect(best?.id).toBe('fix-then-announce');
  });

  /**
   * The reason plays are ranked by specificity rather than declaration order: the near-universal
   * plays would otherwise win every match, and a plainly-pricing subject would be answered with
   * "copy your strongest territory".
   */
  it('prefers a specific play over a near-universal one', () => {
    const ordered = playsFor(cluster());
    expect(ordered[0]!.id).toBe('explain-the-price');
    expect(ordered.map((p) => p.id)).toContain('close-the-territory-gap');
    expect(ordered[0]!.id).not.toBe('close-the-territory-gap');
  });

  it('does not offer a negative-sentiment play to a positive subject', () => {
    const ids = playsFor(cluster({ topic: 'support', sentiment: 0.8, dimensions: ['service'] })).map((p) => p.id);
    expect(ids).not.toContain('respond-to-negative-reviews');
  });

  it('respects a minimum volume, so a one-off is not treated as a pattern', () => {
    const ids = playsFor(cluster({ volume: 1 })).map((p) => p.id);
    expect(ids).not.toContain('explain-the-price');
  });

  /* "No play applies" is a real answer. Inventing generic advice to fill the gap is how a
     roadmap becomes wallpaper. */
  it('returns nothing rather than inventing a fallback', () => {
    const none = playsFor(cluster({ volume: 0, sentiment: 0.9, topic: 'zzz', dimensions: [] }));
    expect(none).toHaveLength(0);
    expect(bestPlayFor(cluster({ volume: 0, sentiment: 0.9, topic: 'zzz', dimensions: [] }))).toBeNull();
  });

  it('looks a play up by id', () => {
    expect(playById('explain-the-price')?.title).toContain('price');
    expect(playById('does-not-exist')).toBeNull();
  });
});
