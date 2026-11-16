import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

let _rows: unknown[] = [];
const _queue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  [
    'select',
    'selectDistinct',
    'from',
    'where',
    'innerJoin',
    'leftJoin',
    'orderBy',
    'limit',
  ].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  const next = () => (_queue.length ? _queue.shift()! : _rows);
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(next()).then(r as never, j as never);
  return {
    db: { get: vi.fn(() => chain) },
    /* The real predicate is exercised against drizzle's dialect in `attributed-to.test.ts`;
       here it only has to be callable, because these tests assert response shape rather than
       SQL. Returning a sentinel keeps `and(...)` happy without pretending to be SQL. */
    attributedTo: vi.fn(() => ({ _attributedTo: true })),
    /* Returns undefined for 'no territory asked for', which is what and() drops. Returning a
       truthy sentinel here would make every test behave as though a filter were applied. */
    territoryFilter: vi.fn(() => undefined),
    brandEntities: {},
    dimensionScores: {},
    signals: {},
    sentimentResults: {},
    sourceConfigs: {},
  };
});

import scoresRoutes from '../../src/routes/scores.js';

const row = (over: Record<string, unknown> = {}) => ({
  dimension: 'trust',
  score: 80,
  date: '2026-08-06',
  signalCount: 4,
  ...over,
});

beforeEach(() => {
  _rows = [];
  _queue.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands/:id/dimension-scores', () => {
  it('returns history rows', async () => {
    _rows = [row(), row({ dimension: 'quality', score: 60 })];
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/dimension-scores',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(2);
  });

  it('accepts an explicit date range', async () => {
    _rows = [row()];
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/dimension-scores?from=2026-01-01&to=2026-02-01',
    });

    expect(res.statusCode).toBe(200);
  });

  it('is brand-scoped', async () => {
    _rows = [];
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b2222222-2222-4222-8222-222222222222/dimension-scores',
    });
    expect(res.statusCode).toBe(403);
  });

  it.each(['garbage', '2026-13-45', '01/02/2026'])(
    'rejects a malformed date (%s) as a 400, where it used to reach Postgres and 500',
    async (from) => {
      const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
      const res = await app.inject({
        method: 'GET',
        url: `/brands/b1111111-1111-4111-8111-111111111111/dimension-scores?from=${encodeURIComponent(from)}`,
      });
      expect(res.statusCode).toBe(400);
    },
  );

  it('rejects a malformed brand id before any query', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/x/dimension-scores' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /brands/:id/score', () => {
  // A brand that has never been scored is not a brand scoring zero; the dashboard has to be
  // able to tell those apart.
  it('returns nulls rather than zero when the brand has no rollup', async () => {
    _queue.push([{ weights: null }]); // brand lookup
    _queue.push([]); // dimension rows
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/score',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      score: null,
      previousScore: null,
      date: null,
      previousDate: null,
      dimensions: [],
      /* The comparison rollup, which the endpoint always computed and used to discard. Without
         it no view could produce a real per-dimension delta, which is why every dimension bar
         rendered `▲ +0` — see apps/web/test/dimbar.test.tsx. */
      previousDimensions: [],
    });
  });

  /* The route is bounded: brand weights, then the latest rollup date, then the latest date at
     least a week before it, then ONLY those two dates' rows. It used to read the brand's entire
     history to use two days of it. Each test queues those four results in that order. */
  it('composites the latest rollup under the default weights', async () => {
    _queue.push([{ weights: null }]);
    _queue.push([{ date: '2026-08-06' }], [{ date: null }]);
    _queue.push([
      row({ dimension: 'trust', score: 80, date: '2026-08-06' }),
      row({ dimension: 'quality', score: 40, date: '2026-08-06' }),
    ]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/score',
    });

    const body = JSON.parse(res.body);
    expect(body.score).toBeCloseTo(60, 6);
    expect(body.date).toBe('2026-08-06');
    expect(body.dimensions).toHaveLength(2);
  });

  it('honours per-brand weights', async () => {
    _queue.push([{ weights: { trust: 0.9, quality: 0.1 } }]);
    _queue.push([{ date: '2026-08-06' }], [{ date: null }]);
    _queue.push([
      row({ dimension: 'trust', score: 100, date: '2026-08-06' }),
      row({ dimension: 'quality', score: 0, date: '2026-08-06' }),
    ]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/score',
    });

    expect(JSON.parse(res.body).score).toBeCloseTo(90, 6);
  });

  it('compares against a rollup at least a week older', async () => {
    _queue.push([{ weights: null }]);
    // Latest 08-06; the most recent date on or before 07-30 is 07-28 (08-05 is too recent).
    _queue.push([{ date: '2026-08-06' }], [{ date: '2026-07-28' }]);
    _queue.push([
      row({ score: 80, date: '2026-08-06' }),
      row({ score: 50, date: '2026-07-28' }), // 9 days back
    ]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/score',
    });

    const body = JSON.parse(res.body);
    expect(body.previousDate).toBe('2026-07-28');
    expect(body.previousScore).toBeCloseTo(50, 6);
  });

  it('reports no comparison when history is shorter than a week', async () => {
    _queue.push([{ weights: null }]);
    _queue.push([{ date: '2026-08-06' }], [{ date: null }]);
    _queue.push([row({ date: '2026-08-06' })]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/score',
    });

    const body = JSON.parse(res.body);
    expect(body.previousScore).toBeNull();
    expect(body.previousDate).toBeNull();
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b2222222-2222-4222-8222-222222222222/score',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /brands/:id/brand-impact', () => {
  const scored = (over: Record<string, unknown> = {}) => ({
    signalId: 's1',
    publishedAt: new Date(),
    score: -1,
    confidence: 1,
    label: 'negative',
    dimensions: ['trust'],
    topics: ['fees'],
    ...over,
  });

  it('ranks clusters by damage', async () => {
    _rows = [
      scored({ signalId: 'a', topics: ['fees'] }),
      scored({ signalId: 'b', topics: ['fees'] }),
      scored({ signalId: 'c', topics: ['queues'], score: -0.3 }),
    ];
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/brand-impact',
    });

    const body = JSON.parse(res.body);
    expect(body[0].topic).toBe('fees');
    expect(body[0].volume).toBe(2);
    expect(body[0].damage).toBeGreaterThan(body[1].damage);
  });

  it('returns at most three by default', async () => {
    _rows = ['a', 'b', 'c', 'd'].map((t, i) =>
      scored({ signalId: t, topics: [t], score: -1 + i * 0.1 }),
    );
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/brand-impact',
    });

    expect(JSON.parse(res.body)).toHaveLength(3);
  });

  it('honours an explicit limit', async () => {
    _rows = ['a', 'b', 'c', 'd'].map((t, i) =>
      scored({ signalId: t, topics: [t], score: -1 + i * 0.1 }),
    );
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/brand-impact?limit=2',
    });

    expect(JSON.parse(res.body)).toHaveLength(2);
  });

  // Padding to three would present topics nobody complained about as weaknesses.
  it('omits clusters with no negativity', async () => {
    _rows = [scored({ score: 1, topics: ['praise'] })];
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/brand-impact',
    });

    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b2222222-2222-4222-8222-222222222222/brand-impact',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /brands/:id/strengths', () => {
  const scored = (over: Record<string, unknown> = {}) => ({
    signalId: 's1',
    publishedAt: new Date(),
    score: 1,
    confidence: 1,
    label: 'positive',
    dimensions: ['quality'],
    topics: ['app design'],
    ...over,
  });

  it('returns the strongest clusters first', async () => {
    _rows = [
      scored({ signalId: 'a', topics: ['loved'], score: 1 }),
      scored({ signalId: 'b', topics: ['loved'], score: 1 }),
      scored({ signalId: 'c', topics: ['liked'], score: 0.3 }),
    ];
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/strengths',
    });

    const body = JSON.parse(res.body);
    expect(body[0].topic).toBe('loved');
    expect(body[0].strength).toBeGreaterThan(body[1].strength);
  });

  // Taking the least-damaging clusters would surface topics nobody praised.
  it('omits clusters with no positive sentiment', async () => {
    _rows = [scored({ score: -1, topics: ['bad'] })];
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/strengths',
    });
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b2222222-2222-4222-8222-222222222222/strengths',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /brands/:id/stats', () => {
  /* Query order in the handler: counts → last rollup date → source counts. */
  it('returns the headline counts and the coverage funnel', async () => {
    _queue.push([
      { totalSignals: 40, thisWeek: '9', previousWeek: '6', scored: '31', classified: '28' },
    ]);
    _queue.push([{ lastDate: '2026-08-16' }]);
    _queue.push([{ configured: 5, active: '3' }]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/stats',
    });

    expect(JSON.parse(res.body)).toEqual({
      signalsThisWeek: 9,
      signalsPreviousWeek: 6,
      totalSignals: 40,
      scoredSignals: 31,
      classifiedSignals: 28,
      lastRollupDate: '2026-08-16',
      activeSources: 3,
      configuredSources: 5,
    });
  });

  /**
   * The signature of the defect this funnel exists to expose.
   *
   * Signals collected and scored, none of them tagged to a dimension, and therefore no rollup
   * row ever written. Two brands sat in exactly this state and nothing in the product said so —
   * `scoredSignals` alone reads as healthy. `classifiedSignals: 0` beside `lastRollupDate: null`
   * is what makes it legible.
   */
  it('reports a brand that is scored but classified into nothing', async () => {
    _queue.push([
      { totalSignals: 10, thisWeek: '2', previousWeek: '1', scored: '10', classified: '0' },
    ]);
    _queue.push([{ lastDate: null }]);
    _queue.push([{ configured: 1, active: '1' }]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/stats',
    });

    const body = JSON.parse(res.body);
    expect(body.scoredSignals).toBe(10);
    expect(body.classifiedSignals).toBe(0);
    expect(body.lastRollupDate).toBeNull();
  });

  it('reports zeroes for a brand with nothing ingested', async () => {
    _queue.push([
      { totalSignals: 0, thisWeek: '0', previousWeek: '0', scored: '0', classified: '0' },
    ]);
    _queue.push([{ lastDate: null }]);
    _queue.push([{ configured: 0, active: '0' }]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/stats',
    });

    expect(JSON.parse(res.body).totalSignals).toBe(0);
  });

  /**
   * The coverage tile is shown beside a territory-filtered score, so its counts must be filtered
   * too. This endpoint was left out of the territory threading and reported all-territory counts
   * under a "United Kingdom" heading — two surfaces disagreeing about what the user is looking
   * at, which is the exact failure the shared query helper exists to prevent. Found by driving
   * the deployed app, not by a test.
   */
  it('passes the territory through to the counts', async () => {
    const { territoryFilter } = await import('@project-signal/db');
    _queue.push([
      { totalSignals: 1, thisWeek: '0', previousWeek: '0', scored: '1', classified: '1' },
    ]);
    _queue.push([{ lastDate: '2026-08-17' }]);
    _queue.push([{ configured: 1, active: '1' }]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/stats?territory=GB',
    });

    expect(res.statusCode).toBe(200);
    expect(territoryFilter).toHaveBeenCalledWith('GB');
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b2222222-2222-4222-8222-222222222222/stats',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /brands/:id/score-history', () => {
  const URL = '/brands/b1111111-1111-4111-8111-111111111111/score-history';

  it('returns the weighted composite per day, the same number /score reports', async () => {
    /* Brand weights trust 3 : quality 1. An unweighted mean of 80 and 40 would be 60; the index
       with these weights is (80×3 + 40×1) / 4 = 70. The sparkline used to plot the former. */
    _queue.push([{ weights: { trust: 3, quality: 1 } }]);
    _queue.push([
      row({ date: '2026-08-05', dimension: 'trust', score: 80, signalCount: 4 }),
      row({ date: '2026-08-05', dimension: 'quality', score: 40, signalCount: 2 }),
      row({ date: '2026-08-06', dimension: 'trust', score: 60, signalCount: 1 }),
    ]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: URL });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([
      { date: '2026-08-05', score: 70, signalCount: 6 },
      { date: '2026-08-06', score: 60, signalCount: 1 },
    ]);
  });

  it('scores a day with only unweighted dimensions exactly as /score would, never as 0', async () => {
    /* quality carries no weight; compositeScore falls back to the unweighted mean for that day
       rather than reporting nothing or zero — the same rule the headline uses. */
    _queue.push([{ weights: { trust: 1 } }]);
    _queue.push([
      row({ date: '2026-08-05', dimension: 'quality', score: 90 }),
      row({ date: '2026-08-06', dimension: 'trust', score: 50 }),
    ]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: URL });

    expect(JSON.parse(res.body)).toEqual([
      { date: '2026-08-05', score: 90, signalCount: 4 },
      { date: '2026-08-06', score: 50, signalCount: 4 },
    ]);
  });

  it('returns an empty history for a brand never rolled up', async () => {
    _queue.push([{ weights: null }], []);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: URL });
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b2222222-2222-4222-8222-222222222222/score-history',
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a malformed date at the schema', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: `${URL}?from=garbage` });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /brands/:id/territories', () => {
  it('merges feed and signal territories, de-duplicated and sorted, without the aggregate', async () => {
    _queue.push(
      [{ territory: 'GB' }, { territory: 'unknown' }],
      [{ territory: 'AU' }, { territory: 'GB' }, { territory: null }, { territory: 'all' }],
    );
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/territories',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ territories: ['AU', 'GB', 'unknown'] });
  });

  it('is open to a plain user on their own brand — the lens was admin-only before', async () => {
    _queue.push([{ territory: 'GB' }], []);
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/territories',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ territories: ['GB'] });
  });

  it('refuses a pinned user another brand', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b2222222-2222-4222-8222-222222222222/territories',
    });
    expect(res.statusCode).toBe(403);
  });
});
