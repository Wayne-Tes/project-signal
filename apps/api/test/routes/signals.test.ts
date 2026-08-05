import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN } from '../helpers/app.js';

let _dbRows: unknown[] = [];
const _dbRowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  ['select', 'from', 'where', 'insert', 'values', 'update', 'set',
    'innerJoin', 'limit', 'offset', 'onConflictDoUpdate', 'onConflictDoNothing']
    .forEach(m => { chain[m] = vi.fn(() => chain); });
  const nextRows = () => (_dbRowQueue.length ? _dbRowQueue.shift()! : _dbRows);
  chain['returning'] = vi.fn(() => Promise.resolve(nextRows()));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(nextRows()).then(r as never, j as never);
  chain['transaction'] = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(chain));
  return {
    db: { get: vi.fn(() => chain) },
    tenants: {}, brandEntities: {}, signals: {}, users: {},
    sentimentResults: {}, dimensionScores: {}, sourceConfigs: {}, client: { get: vi.fn() },
  };
});

import signalsRoutes from '../../src/routes/signals.js';

const now = new Date();
const signal = (id: string) => ({
  id,
  tenantId: 'tenant-1',
  brandEntityId: 'brand-1',
  source: 'google_reviews',
  sourceUrl: 'https://maps.google.com/review/1',
  rawStorageRef: 'gs://bucket/1',
  publishedAt: now,
  ingestedAt: now,
});

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands/:id/signals', () => {
  it('returns signals for a brand', async () => {
    _dbRows = [signal('s1'), signal('s2')];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
  });

  it('paginates: returns nextCursor when more items exist than limit', async () => {
    // Return limit+1 items to trigger pagination
    const items = Array.from({ length: 51 }, (_, i) => signal(`s${i}`));
    _dbRows = items;
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals?limit=50' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(50);
    expect(body.nextCursor).not.toBeNull();
  });

  it('returns empty items when brand has no signals', async () => {
    _dbRows = [];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ items: [], nextCursor: null });
  });
});

describe('GET /brands/:id/sentiment-summary', () => {
  it('returns aggregated sentiment data for last 30 days', async () => {
    _dbRows = [{
      totalCount: '10',
      avgScore: '0.75',
      positiveCount: '7',
      negativeCount: '1',
      neutralCount: '1',
      mixedCount: '1',
    }];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/sentiment-summary' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalCount).toBe(10);
    expect(body.positiveCount).toBe(7);
    expect(body.avgScore).toBeCloseTo(0.75);
    expect(body.period).toBe('30d');
  });

  it('returns zero counts and null avgScore when no data', async () => {
    _dbRows = [{ totalCount: '0', avgScore: null, positiveCount: '0', negativeCount: '0', neutralCount: '0', mixedCount: '0' }];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/sentiment-summary' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalCount).toBe(0);
    expect(body.avgScore).toBeNull();
  });
});

describe('GET /brands/:id/dimension-scores', () => {
  it('returns dimension scores for a brand', async () => {
    _dbRows = [
      { dimension: 'trust', score: 78.5, date: '2024-01-01', signalCount: 5 },
      { dimension: 'quality', score: 82.0, date: '2024-01-01', signalCount: 5 },
    ];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/dimension-scores' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].dimension).toBe('trust');
  });
});
