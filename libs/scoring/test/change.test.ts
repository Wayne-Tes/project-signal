import { describe, expect, it } from 'vitest';
import {
  isBackfilled,
  splitPeriods,
  summariseChange,
  summariseSources,
  type ChangeItem,
} from '../src/change.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-17T12:00:00.000Z');

function item(over: Partial<ChangeItem> & { daysAgo: number }): ChangeItem {
  const at = new Date(NOW.getTime() - over.daysAgo * DAY);
  return {
    signalId: over.signalId ?? `sig-${over.daysAgo}-${Math.round((over.score ?? 0) * 100)}`,
    publishedAt: over.publishedAt ?? at,
    ingestedAt: over.ingestedAt ?? at,
    source: over.source ?? 'rss',
    score: over.score ?? 0,
    label: over.label ?? 'neutral',
    topics: over.topics ?? [],
  };
}

describe('splitPeriods', () => {
  it('compares equal-length windows', () => {
    const items = [item({ daysAgo: 1 }), item({ daysAgo: 8 }), item({ daysAgo: 20 })];
    const { current, previous } = splitPeriods(items, NOW, 7, 'published');

    expect(current).toHaveLength(1);
    /* Day 8 is inside the prior seven days; day 20 is outside both and must not be counted as
       "before", or every topic would look like it is collapsing. */
    expect(previous).toHaveLength(1);
  });

  it('reads the ingestion date when asked to, not the publication date', () => {
    /* A March review that a newly connected feed surfaced today is new TO US. Which of the two
       dates is used is the difference between "what we learned" and "what the world said". */
    const backfilled = item({
      daysAgo: 0,
      publishedAt: new Date(NOW.getTime() - 200 * DAY),
      ingestedAt: NOW,
    });

    expect(splitPeriods([backfilled], NOW, 7, 'ingested').current).toHaveLength(1);
    expect(splitPeriods([backfilled], NOW, 7, 'published').current).toHaveLength(0);
  });

  it('drops future-dated items rather than counting them in every period', () => {
    const future = item({ daysAgo: -3 });
    const { current, previous } = splitPeriods([future], NOW, 7, 'published');
    expect(current).toHaveLength(0);
    expect(previous).toHaveLength(0);
  });
});

describe('summariseChange — what is new', () => {
  const opts = { asOf: NOW, days: 7, basis: 'published' as const };

  it('reports a topic never seen before as new', () => {
    const items = [item({ daysAgo: 2, topics: ['pricing'], score: -0.5 })];
    const firstSeen = new Map([['pricing', new Date(NOW.getTime() - 2 * DAY)]]);

    const out = summariseChange(items, firstSeen, opts);
    expect(out.newTopics.map((t) => t.topic)).toEqual(['pricing']);
  });

  /**
   * The distinction that makes "new" mean anything.
   *
   * A topic discussed in March, quiet through July and back this week is RETURNING, not new.
   * Calling it new sends whoever acts on it looking for a cause that is months old.
   */
  it('does not call a returning topic new', () => {
    const items = [item({ daysAgo: 2, topics: ['pricing'] })];
    const firstSeen = new Map([['pricing', new Date(NOW.getTime() - 120 * DAY)]]);

    const out = summariseChange(items, firstSeen, opts);
    expect(out.newTopics).toHaveLength(0);
  });

  it('treats a topic with no recorded first sighting as new', () => {
    const items = [item({ daysAgo: 1, topics: ['onboarding'] })];
    const out = summariseChange(items, new Map(), opts);
    expect(out.newTopics.map((t) => t.topic)).toEqual(['onboarding']);
  });

  it('matches topics case- and whitespace-insensitively', () => {
    const items = [
      item({ daysAgo: 1, topics: [' Pricing '] }),
      item({ daysAgo: 9, topics: ['pricing'] }),
    ];
    const firstSeen = new Map([['pricing', new Date(NOW.getTime() - 9 * DAY)]]);

    const out = summariseChange(items, firstSeen, opts);
    /* Not new, and — the proof the two spellings were matched — it has a previous period. If the
       normalisation had failed, ' Pricing ' would be an unrecognised topic and therefore new. */
    expect(out.newTopics).toHaveLength(0);
    const [row] = out.risingTopics.concat(out.fallingTopics, out.improvingTopics);
    expect(row?.topic ?? 'pricing').toBe('pricing');
  });

  it('counts one signal once per topic, even if the model repeats a tag', () => {
    const items = [item({ daysAgo: 1, topics: ['pricing', 'pricing', 'PRICING'] })];
    const out = summariseChange(items, new Map(), opts);
    expect(out.newTopics[0]!.volume).toBe(1);
  });
});

describe('summariseChange — rising and falling', () => {
  const opts = { asOf: NOW, days: 7, basis: 'published' as const };
  const firstSeen = new Map([
    ['pricing', new Date(NOW.getTime() - 100 * DAY)],
    ['support', new Date(NOW.getTime() - 100 * DAY)],
  ]);

  it('ranks a topic gaining volume as rising', () => {
    const items = [
      item({ daysAgo: 1, topics: ['pricing'] }),
      item({ daysAgo: 2, topics: ['pricing'] }),
      item({ daysAgo: 9, topics: ['pricing'] }),
    ];
    const out = summariseChange(items, firstSeen, opts);
    expect(out.risingTopics.map((t) => t.topic)).toEqual(['pricing']);
    expect(out.risingTopics[0]!.volumeDelta).toBe(1);
  });

  /**
   * A topic that stopped entirely is the largest possible fall, and it has no bucket in the
   * current period at all — so reading only the current period makes it invisible. Silence
   * looking like calm is exactly the failure this view exists to prevent.
   */
  it('reports a topic that vanished, not just one that shrank', () => {
    const items = [item({ daysAgo: 9, topics: ['support'] }), item({ daysAgo: 10, topics: ['support'] })];
    const out = summariseChange(items, firstSeen, opts);

    const support = out.fallingTopics.find((t) => t.topic === 'support');
    expect(support).toBeDefined();
    expect(support!.volume).toBe(0);
    expect(support!.previousVolume).toBe(2);
    expect(support!.volumeDelta).toBe(-2);
  });

  it('does not list a new topic as rising as well', () => {
    /* It is already reported under "new". Listing it twice inflates the only page a reader uses
       to decide what to look at first. */
    const items = [item({ daysAgo: 1, topics: ['brand new'] })];
    const out = summariseChange(items, new Map(), opts);
    expect(out.newTopics).toHaveLength(1);
    expect(out.risingTopics).toHaveLength(0);
  });
});

describe('summariseChange — comparisons that do not exist', () => {
  const opts = { asOf: NOW, days: 7, basis: 'published' as const };

  /**
   * `null`, never `0`.
   *
   * "No prior data" and "exactly no change" are different facts, and rendering them identically
   * is what produced `▲ +0` on every dimension bar — a green improvement marker against a
   * comparison point that did not exist.
   */
  it('reports a null sentiment delta when there is no previous period', () => {
    const out = summariseChange([item({ daysAgo: 1, score: 0.5 })], new Map(), opts);
    expect(out.previousSentiment).toBeNull();
    expect(out.sentimentDelta).toBeNull();
  });

  it('reports a null topic sentiment delta when the topic is new', () => {
    const out = summariseChange([item({ daysAgo: 1, topics: ['x'], score: 0.4 })], new Map(), opts);
    expect(out.newTopics[0]!.previousSentiment).toBeNull();
    expect(out.newTopics[0]!.sentimentDelta).toBeNull();
  });

  it('reports a real zero delta as zero, not as null', () => {
    const items = [
      item({ daysAgo: 1, score: 0.5, topics: ['x'] }),
      item({ daysAgo: 9, score: 0.5, topics: ['x'] }),
    ];
    const firstSeen = new Map([['x', new Date(NOW.getTime() - 90 * DAY)]]);
    const out = summariseChange(items, firstSeen, opts);
    expect(out.sentimentDelta).toBe(0);
  });

  it('reports null sentiment for a period with no signals at all', () => {
    const out = summariseChange([], new Map(), opts);
    expect(out.sentiment).toBeNull();
    expect(out.sentimentDelta).toBeNull();
    expect(out.signalsThisPeriod).toBe(0);
  });
});

describe('backfill detection', () => {
  it('marks a signal collected long after publication as backfilled', () => {
    const old = item({
      daysAgo: 0,
      publishedAt: new Date(NOW.getTime() - 200 * DAY),
      ingestedAt: NOW,
    });
    expect(isBackfilled(old)).toBe(true);
  });

  it('does not mark a normally-collected signal as backfilled', () => {
    expect(isBackfilled(item({ daysAgo: 1 }))).toBe(false);
  });

  /**
   * Connecting a feed imports its whole history at once. Counting that as a week's conversation
   * would show a surge nothing in the world actually did — so the count is reported beside the
   * total rather than hidden inside it.
   */
  it('counts backfilled signals separately from the period total', () => {
    const items = [
      item({ daysAgo: 1 }),
      item({ daysAgo: 0, publishedAt: new Date(NOW.getTime() - 300 * DAY), ingestedAt: NOW }),
    ];
    const out = summariseChange(items, new Map(), { asOf: NOW, days: 7, basis: 'ingested' });
    expect(out.signalsThisPeriod).toBe(2);
    expect(out.backfilledThisPeriod).toBe(1);
  });
});

describe('summariseSources', () => {
  it('keeps a source that stopped producing, showing it as a drop to zero', () => {
    /* A silent feed and a healthy one are indistinguishable if only the current period is
       listed, and telling them apart is the whole point of the breakdown. */
    const current = [item({ daysAgo: 1, source: 'rss' })];
    const previous = [item({ daysAgo: 9, source: 'reddit' })];

    const rows = summariseSources(current, previous);
    const reddit = rows.find((r) => r.source === 'reddit');
    expect(reddit).toBeDefined();
    expect(reddit!.volume).toBe(0);
    expect(reddit!.previousVolume).toBe(1);
  });

  it('reports a null sentiment for a source with nothing this period', () => {
    const rows = summariseSources([], [item({ daysAgo: 9, source: 'reddit', score: -0.4 })]);
    expect(rows[0]!.sentiment).toBeNull();
    expect(rows[0]!.sentimentDelta).toBeNull();
    expect(rows[0]!.previousSentiment).toBeCloseTo(-0.4);
  });

  it('orders by current volume, busiest first', () => {
    const current = [
      item({ daysAgo: 1, source: 'rss' }),
      item({ daysAgo: 1, source: 'rss' }),
      item({ daysAgo: 1, source: 'reddit' }),
    ];
    expect(summariseSources(current, []).map((r) => r.source)).toEqual(['rss', 'reddit']);
  });
});

/**
 * Sentiment movement, which is the question the whole feature was asked for.
 *
 * The first version of this module reported volume movement only, and these tests are what
 * exposed the gap: a topic discussed exactly as much as last week whose sentiment collapsed
 * appeared in NEITHER list, because its `volumeDelta` was zero. That is the most important thing
 * that can happen to a topic and it was invisible.
 */
describe('summariseChange — is it getting better or worse', () => {
  const opts = { asOf: NOW, days: 7, basis: 'published' as const };
  const firstSeen = new Map([['support', new Date(NOW.getTime() - 100 * DAY)]]);

  it('surfaces a topic whose sentiment collapsed while its volume stayed flat', () => {
    const items = [
      item({ daysAgo: 1, topics: ['support'], score: -0.6, signalId: 'now-1' }),
      item({ daysAgo: 9, topics: ['support'], score: 0.6, signalId: 'then-1' }),
    ];
    const out = summariseChange(items, firstSeen, opts);

    expect(out.risingTopics, 'volume did not move, so it must not be here').toHaveLength(0);
    expect(out.fallingTopics).toHaveLength(0);

    expect(out.worseningTopics.map((t) => t.topic)).toEqual(['support']);
    expect(out.worseningTopics[0]!.sentimentDelta).toBeCloseTo(-1.2);
  });

  it('surfaces the same movement in the other direction', () => {
    const items = [
      item({ daysAgo: 1, topics: ['support'], score: 0.6, signalId: 'now-1' }),
      item({ daysAgo: 9, topics: ['support'], score: -0.6, signalId: 'then-1' }),
    ];
    const out = summariseChange(items, firstSeen, opts);
    expect(out.improvingTopics.map((t) => t.topic)).toEqual(['support']);
    expect(out.worseningTopics).toHaveLength(0);
  });

  it('ignores movement below the noise threshold', () => {
    /* Re-scoring varies slightly and a mean over a few signals drifts on its own. A page where
       everything changes every week is one nobody reads. */
    const items = [
      item({ daysAgo: 1, topics: ['support'], score: 0.5, signalId: 'now-1' }),
      item({ daysAgo: 9, topics: ['support'], score: 0.45, signalId: 'then-1' }),
    ];
    const out = summariseChange(items, firstSeen, opts);
    expect(out.improvingTopics).toHaveLength(0);
    expect(out.worseningTopics).toHaveLength(0);
  });

  it('ranks a big subject moving moderately above a tiny one swinging wildly', () => {
    const seen = new Map([
      ['big', new Date(NOW.getTime() - 100 * DAY)],
      ['tiny', new Date(NOW.getTime() - 100 * DAY)],
    ]);
    const items = [
      /* big: five signals this period at -0.3, five last period at +0.3 → delta 0.6, volume 5 */
      ...[1, 2, 3, 4, 5].map((n) =>
        item({ daysAgo: 1, topics: ['big'], score: -0.3, signalId: `b-now-${n}` }),
      ),
      ...[1, 2, 3, 4, 5].map((n) =>
        item({ daysAgo: 9, topics: ['big'], score: 0.3, signalId: `b-then-${n}` }),
      ),
      /* tiny: one signal each side, delta 1.6, volume 1 */
      item({ daysAgo: 1, topics: ['tiny'], score: -0.8, signalId: 't-now' }),
      item({ daysAgo: 9, topics: ['tiny'], score: 0.8, signalId: 't-then' }),
    ];

    const out = summariseChange(items, seen, opts);
    /* 0.6 × 5 = 3.0 beats 1.6 × 1 = 1.6. Ranking on the raw delta would put the two-signal topic
       first, which is how a dashboard ends up leading on noise. */
    expect(out.worseningTopics.map((t) => t.topic)).toEqual(['big', 'tiny']);
  });

  it('never ranks a topic that has no comparison point', () => {
    const out = summariseChange([item({ daysAgo: 1, topics: ['fresh'], score: -0.9 })], new Map(), opts);
    expect(out.improvingTopics).toHaveLength(0);
    expect(out.worseningTopics).toHaveLength(0);
    expect(out.newTopics.map((t) => t.topic)).toEqual(['fresh']);
  });
});
