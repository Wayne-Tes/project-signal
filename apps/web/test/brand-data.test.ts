import { describe, expect, it } from 'vitest';
import {
  formatDayLabel,
  isDimensionKey,
  roundScore,
  toCompetitorRows,
  toDimensionCards,
  toHeelCards,
  toHistory,
  type ApiBrand,
  type ApiBrandScore,
  type ApiCluster,
  type ApiDimensionRow,
} from '../src/lib/brand-data';

const dim = (over: Partial<ApiDimensionRow> = {}): ApiDimensionRow => ({
  dimension: 'trust',
  score: 80,
  date: '2026-08-06',
  signalCount: 4,
  ...over,
});

const score = (over: Partial<ApiBrandScore> = {}): ApiBrandScore => ({
  score: 70,
  previousScore: 60,
  date: '2026-08-06',
  previousDate: '2026-07-28',
  dimensions: [dim()],
  ...over,
});

describe('isDimensionKey', () => {
  it('accepts the five dimensions and rejects anything else', () => {
    expect(isDimensionKey('trust')).toBe(true);
    expect(isDimensionKey('experience')).toBe(true);
    expect(isDimensionKey('vibes')).toBe(false);
  });
});

describe('roundScore', () => {
  it('keeps one decimal rather than implying more precision', () => {
    expect(roundScore(31.2499)).toBe(31.2);
    expect(roundScore(95)).toBe(95);
  });
});

describe('toDimensionCards', () => {
  it('returns cards in the fixed dimension order, not API order', () => {
    const cards = toDimensionCards(
      score({
        dimensions: [dim({ dimension: 'experience' }), dim({ dimension: 'trust' })],
      }),
    );
    expect(cards.map((c) => c.key)).toEqual(['trust', 'experience']);
  });

  // The API omits dimensions with no data, and so must the UI — a dimension nobody has
  // mentioned is not a dimension scoring zero.
  it('omits dimensions the brand has no data for', () => {
    const cards = toDimensionCards(score({ dimensions: [dim({ dimension: 'trust' })] }));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.key).toBe('trust');
  });

  it('reports null when there is no comparison point, not a zero delta', () => {
    const cards = toDimensionCards(score());
    expect(cards[0]!.previous).toBeNull();
  });

  it('pairs each dimension with its own earlier value', () => {
    const cards = toDimensionCards(
      score({ dimensions: [dim({ dimension: 'trust', score: 80 })] }),
      [dim({ dimension: 'trust', score: 55, date: '2026-07-28' })],
    );
    expect(cards[0]!.previous).toBe(55);
  });

  it('carries the signal count through for the evidence caption', () => {
    const cards = toDimensionCards(score({ dimensions: [dim({ signalCount: 12 })] }));
    expect(cards[0]!.signalCount).toBe(12);
  });
});

describe('toHistory', () => {
  it('collapses one row per dimension per day into one point per day', () => {
    const points = toHistory([
      dim({ dimension: 'trust', score: 80, date: '2026-08-01' }),
      dim({ dimension: 'quality', score: 60, date: '2026-08-01' }),
      dim({ dimension: 'trust', score: 82, date: '2026-08-02' }),
    ]);

    expect(points).toHaveLength(2);
    expect(points[0]!.scores).toEqual({ trust: 80, quality: 60 });
    expect(points[1]!.scores).toEqual({ trust: 82 });
  });

  it('sorts chronologically regardless of input order', () => {
    const points = toHistory([dim({ date: '2026-08-05' }), dim({ date: '2026-08-01' })]);
    expect(points.map((p) => p.date)).toEqual(['2026-08-01', '2026-08-05']);
  });

  // A partial rollup — say the job died halfway — should still plot what it produced.
  it('keeps a day with only some dimensions rather than dropping it', () => {
    const points = toHistory([dim({ dimension: 'value', date: '2026-08-03' })]);
    expect(points[0]!.scores).toEqual({ value: 80 });
  });

  it('ignores rows whose dimension is not one of the five', () => {
    const points = toHistory([dim({ dimension: 'vibes' })]);
    expect(points).toEqual([]);
  });

  it('returns nothing for an empty history', () => {
    expect(toHistory([])).toEqual([]);
  });
});

describe('formatDayLabel', () => {
  it('formats an ISO date for the axis', () => {
    expect(formatDayLabel('2026-08-06')).toBe('6 Aug');
  });

  it('passes an unparseable value through rather than rendering "Invalid Date"', () => {
    expect(formatDayLabel('not-a-date')).toBe('not-a-date');
  });
});

describe('toCompetitorRows', () => {
  const brands: ApiBrand[] = [
    { id: 'b1', name: 'Ours', slug: 'ours', isOwned: true },
    { id: 'b2', name: 'Rival', slug: 'rival', isOwned: false },
  ];

  it('sorts by score, highest first', () => {
    const rows = toCompetitorRows(
      brands,
      new Map([
        ['b1', score({ score: 40 })],
        ['b2', score({ score: 90 })],
      ]),
    );
    expect(rows.map((r) => r.name)).toEqual(['Rival', 'Ours']);
  });

  // An unmeasured brand is not a brand scoring zero; ranking it last with a null score keeps
  // the distinction visible instead of implying it came bottom.
  it('sorts unscored brands last with a null score', () => {
    const rows = toCompetitorRows(brands, new Map([['b2', score({ score: 90 })]]));
    expect(rows[1]!.name).toBe('Ours');
    expect(rows[1]!.score).toBeNull();
  });

  it('orders unscored brands by name so the list is stable', () => {
    const rows = toCompetitorRows(brands, new Map());
    expect(rows.map((r) => r.name)).toEqual(['Ours', 'Rival']);
  });

  it('flags owned brands so the view can mark them', () => {
    const rows = toCompetitorRows(brands, new Map([['b1', score()]]));
    expect(rows.find((r) => r.name === 'Ours')!.isOwned).toBe(true);
  });
});

describe('toHeelCards', () => {
  const cluster = (over: Partial<ApiCluster> = {}): ApiCluster => ({
    topic: 'hidden fees',
    volume: 5,
    negativity: 0.8,
    positivity: 0,
    recency: 0.99,
    damage: 3.968,
    strength: 0,
    sentiment: -0.8,
    dimensions: ['trust'],
    ...over,
  });

  it('capitalises the model-supplied topic for display', () => {
    expect(toHeelCards([cluster()])[0]!.title).toBe('Hidden fees');
  });

  it('takes the first recognised dimension as the primary label', () => {
    const [card] = toHeelCards([cluster({ dimensions: ['vibes', 'value'] })]);
    expect(card!.dimensionKey).toBe('value');
    expect(card!.dimensionLabel).toBe('Value');
  });

  it('reports no dimension rather than guessing when none is recognised', () => {
    const [card] = toHeelCards([cluster({ dimensions: [] })]);
    expect(card!.dimensionKey).toBeNull();
    expect(card!.dimensionLabel).toBeNull();
  });

  it('rounds damage for display', () => {
    expect(toHeelCards([cluster({ damage: 3.968953 })])[0]!.damage).toBe(4);
  });

  it('preserves API order, which is already damage-ranked', () => {
    const cards = toHeelCards([cluster({ topic: 'a' }), cluster({ topic: 'b' })]);
    expect(cards.map((c) => c.topic)).toEqual(['a', 'b']);
  });
});
