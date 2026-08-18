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

/**
 * Found by reading live output, not by reasoning.
 *
 * Every subject on the deployed brand had volume 1. `fix-then-announce` correctly declined
 * (it needs a pattern), which left the least-constrained play winning every match on an
 * alphabetical tie-break — so the roadmap proposed a cross-market comparison project off a
 * single complaint, eight times over.
 */
describe('thin subjects', () => {
  const oneOff = (over: Partial<MatchableCluster> = {}): MatchableCluster => ({
    topic: 'product not working',
    volume: 1,
    sentiment: -0.9,
    dimensions: ['quality', 'service'],
    ...over,
  });

  it('does not propose a cross-market project off a single complaint', () => {
    expect(bestPlayFor(oneOff())?.id).not.toBe('close-the-territory-gap');
  });

  /* "Not enough of a pattern to act on yet" is the honest answer, and acting on noise costs
     credibility for the next real finding. */
  it('says to watch rather than act', () => {
    expect(bestPlayFor(oneOff())?.id).toBe('watch-only');
  });

  it('still prescribes a real fix once there is a pattern', () => {
    expect(bestPlayFor(oneOff({ volume: 4 }))?.id).toBe('fix-then-announce');
  });

  it('offers the territory comparison only when the subject has real volume', () => {
    expect(playsFor(oneOff()).map((p) => p.id)).not.toContain('close-the-territory-gap');
    expect(playsFor(oneOff({ volume: 5, topic: 'general' })).map((p) => p.id)).toContain(
      'close-the-territory-gap',
    );
  });
});

/**
 * The subjects TES's live signals actually contain.
 *
 * These plays were added from real topic tags on the deployed brand — safeguarding, staffing,
 * resources — rather than from invented categories. A playbook full of plausible-sounding plays
 * that never match anything is decoration.
 */
describe('the observed subjects', () => {
  const c = (topic: string, over: Partial<MatchableCluster> = {}): MatchableCluster => ({
    topic,
    volume: 3,
    sentiment: -0.6,
    dimensions: ['trust', 'service'],
    ...over,
  });

  /**
   * Safeguarding outranks everything, deliberately, at volume 1. It is the one subject where a
   * slow response is read as a position rather than as a delay — so it must not wait for a
   * pattern the way an engineering fix does.
   */
  it('answers a safeguarding concern even on a single signal', () => {
    expect(bestPlayFor(c('safeguarding concerns', { volume: 1 }))?.id).toBe(
      'safeguarding-response',
    );
    expect(bestPlayFor(c('safety concerns', { volume: 1 }))?.id).toBe('safeguarding-response');
  });

  it('does not tell you to argue with a safeguarding concern in public', () => {
    const play = playById('safeguarding-response')!;
    expect(play.steps.join(' ')).toMatch(/never dispute/i);
  });

  it('matches the recruitment subjects this tenant actually collects', () => {
    expect(bestPlayFor(c('school staffing'))?.id).toBe('recruitment-experience');
    expect(bestPlayFor(c('recruitment'))?.id).toBe('recruitment-experience');
  });

  it('matches content-quality complaints', () => {
    expect(bestPlayFor(c('educational content', { dimensions: ['quality'] }))?.id).toBe(
      'resource-quality',
    );
  });

  /* Self-inflicted subjects need the cause stopped before a response is designed — a response
     running alongside its own cause does not work. */
  it('reaches for pausing the cause only on a loud, clearly negative subject', () => {
    const ids = playsFor(c('policy change', { volume: 6, sentiment: -0.8 })).map((p) => p.id);
    expect(ids).toContain('stop-the-bleeding');
    expect(playsFor(c('policy change', { volume: 2, sentiment: -0.2 })).map((p) => p.id)).not.toContain(
      'stop-the-bleeding',
    );
  });

  it('keeps the library free of steps that merely restate the goal', () => {
    /* Re-asserted over the enlarged set, because the temptation grows with the library. */
    const vague = /^(improve|increase|enhance|optimi[sz]e|boost) /i;
    for (const play of PLAYS) {
      for (const step of play.steps) {
        expect(vague.test(step.trim()), `${play.id}: "${step}"`).toBe(false);
      }
    }
  });

  it('has grown to a usable library rather than a token one', () => {
    expect(PLAYS.length).toBeGreaterThanOrEqual(15);
  });
});

/**
 * Pinning the weighting that decides which play wins.
 *
 * A topic pattern is a direct textual hit on what the complaint is about. A dimension is broad —
 * five exist and most clusters touch two. Weighting them comparably treats a coincidence as
 * evidence, and it did: a safeguarding concern was answered with "contact the publication about a
 * factual error", on the one subject where wrong advice is least affordable.
 */
describe('specificity weighting', () => {
  it('lets a topic match beat a dimension match, whatever the alphabet says', () => {
    /* `correct-the-record` sorts first alphabetically and matches on trust + sentiment + volume.
       `safeguarding-response` matches on the words themselves and must win. */
    const cluster: MatchableCluster = {
      topic: 'safeguarding concerns',
      volume: 1,
      sentiment: -0.7,
      dimensions: ['trust', 'service'],
    };
    const ordered = playsFor(cluster).map((p) => p.id);
    expect(ordered.indexOf('safeguarding-response')).toBeLessThan(
      ordered.indexOf('correct-the-record'),
    );
  });
});
