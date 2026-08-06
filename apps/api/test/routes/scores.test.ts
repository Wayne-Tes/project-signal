import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

let _rows: unknown[] = [];
const _queue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  ['select', 'from', 'where', 'innerJoin', 'orderBy', 'limit'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  const next = () => (_queue.length ? _queue.shift()! : _rows);
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(next()).then(r as never, j as never);
  return {
    db: { get: vi.fn(() => chain) },
    brandEntities: {},
    dimensionScores: {},
    signals: {},
    sentimentResults: {},
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
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/dimension-scores' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(2);
  });

  it('accepts an explicit date range', async () => {
    _rows = [row()];
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/brand-1/dimension-scores?from=2026-01-01&to=2026-02-01',
    });

    expect(res.statusCode).toBe(200);
  });

  it('is brand-scoped', async () => {
    _rows = [];
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/dimension-scores' });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /brands/:id/score', () => {
  // A brand that has never been scored is not a brand scoring zero; the dashboard has to be
  // able to tell those apart.
  it('returns nulls rather than zero when the brand has no rollup', async () => {
    _queue.push([{ weights: null }]); // brand lookup
    _queue.push([]); // dimension rows
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/score' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      score: null,
      previousScore: null,
      date: null,
      previousDate: null,
      dimensions: [],
    });
  });

  it('composites the latest rollup under the default weights', async () => {
    _queue.push([{ weights: null }]);
    _queue.push([
      row({ dimension: 'trust', score: 80, date: '2026-08-06' }),
      row({ dimension: 'quality', score: 40, date: '2026-08-06' }),
    ]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/score' });

    const body = JSON.parse(res.body);
    expect(body.score).toBeCloseTo(60, 6);
    expect(body.date).toBe('2026-08-06');
    expect(body.dimensions).toHaveLength(2);
  });

  it('honours per-brand weights', async () => {
    _queue.push([{ weights: { trust: 0.9, quality: 0.1 } }]);
    _queue.push([
      row({ dimension: 'trust', score: 100, date: '2026-08-06' }),
      row({ dimension: 'quality', score: 0, date: '2026-08-06' }),
    ]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/score' });

    expect(JSON.parse(res.body).score).toBeCloseTo(90, 6);
  });

  it('compares against a rollup at least a week older', async () => {
    _queue.push([{ weights: null }]);
    _queue.push([
      row({ score: 80, date: '2026-08-06' }),
      row({ score: 70, date: '2026-08-05' }), // too recent to be the comparison
      row({ score: 50, date: '2026-07-28' }), // 9 days back
    ]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/score' });

    const body = JSON.parse(res.body);
    expect(body.previousDate).toBe('2026-07-28');
    expect(body.previousScore).toBeCloseTo(50, 6);
  });

  it('reports no comparison when history is shorter than a week', async () => {
    _queue.push([{ weights: null }]);
    _queue.push([row({ date: '2026-08-06' }), row({ date: '2026-08-05' })]);
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/score' });

    const body = JSON.parse(res.body);
    expect(body.previousScore).toBeNull();
    expect(body.previousDate).toBeNull();
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/score' });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /brands/:id/achilles', () => {
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
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/achilles' });

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
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/achilles' });

    expect(JSON.parse(res.body)).toHaveLength(3);
  });

  it('honours an explicit limit', async () => {
    _rows = ['a', 'b', 'c', 'd'].map((t, i) =>
      scored({ signalId: t, topics: [t], score: -1 + i * 0.1 }),
    );
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/achilles?limit=2' });

    expect(JSON.parse(res.body)).toHaveLength(2);
  });

  // Padding to three would present topics nobody complained about as weaknesses.
  it('omits clusters with no negativity', async () => {
    _rows = [scored({ score: 1, topics: ['praise'] })];
    const app = await buildTestApp(scoresRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/achilles' });

    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(scoresRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/achilles' });
    expect(res.statusCode).toBe(403);
  });
});
