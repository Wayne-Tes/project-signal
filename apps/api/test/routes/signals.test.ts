import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

let _dbRows: unknown[] = [];
const _dbRowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  [
    'select',
    'from',
    'where',
    'insert',
    'values',
    'update',
    'set',
    'innerJoin',
    'limit',
    'offset',
    'orderBy',
    'onConflictDoUpdate',
    'onConflictDoNothing',
  ].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  const nextRows = () => (_dbRowQueue.length ? _dbRowQueue.shift()! : _dbRows);
  chain['returning'] = vi.fn(() => Promise.resolve(nextRows()));
  chain['then'] = (r: unknown, j?: unknown) =>
    Promise.resolve(nextRows()).then(r as never, j as never);
  chain['transaction'] = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(chain));
  return {
    db: { get: vi.fn(() => chain) },
    tenants: {},
    brandEntities: {},
    signals: {},
    users: {},
    sentimentResults: {},
    dimensionScores: {},
    sourceConfigs: {},
    client: { get: vi.fn() },
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

  // The response schema declared `items: { type: 'object' }` with no properties, and
  // fast-json-stringify strips everything undeclared — so this endpoint returned
  // `items: [{}, {}]` for its entire life. Assert the payload actually carries fields.
  it('serialises signal fields rather than empty objects', async () => {
    _dbRows = [signal('s1')];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });

    const [item] = JSON.parse(res.body).items;
    expect(item).toMatchObject({
      id: 's1',
      tenantId: 'tenant-1',
      brandEntityId: 'brand-1',
      source: 'google_reviews',
      sourceUrl: 'https://maps.google.com/review/1',
      rawStorageRef: 'gs://bucket/1',
    });
    expect(item.publishedAt).toBe(now.toISOString());
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

  // KNOWN-GAPS #6 — without a deterministic ORDER BY, keyset pagination over a random
  // UUID can repeat rows, skip rows, or terminate early.
  it('orders by published_at then id so the keyset is deterministic', async () => {
    _dbRows = [signal('s1')];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });

    const { db } = await import('@project-signal/db');
    expect(
      (db.get() as unknown as { orderBy: ReturnType<typeof vi.fn> }).orderBy,
    ).toHaveBeenCalledOnce();
  });

  it('returns a composite cursor encoding both publishedAt and id', async () => {
    const items = Array.from({ length: 51 }, (_, i) => signal(`s${i}`));
    _dbRows = items;
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals?limit=50' });

    const { nextCursor } = JSON.parse(res.body);
    const decoded = Buffer.from(nextCursor, 'base64url').toString('utf8');
    expect(decoded).toBe(`${now.toISOString()}|s49`);
  });

  it('rejects a malformed cursor rather than silently returning the first page', async () => {
    _dbRows = [signal('s1')];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/brand-1/signals?cursor=not-a-real-cursor',
    });
    expect(res.statusCode).toBe(400);
  });
});

// KNOWN-GAPS #5 — cross-tenant isolation held, but a `user` pinned to brand A could read
// brand B's data inside the same tenant by changing the URL.
describe('brand-scoped authorisation', () => {
  const routes = ['signals', 'sentiment-summary', 'dimension-scores'] as const;

  for (const route of routes) {
    it(`allows a pinned user to read their own brand's ${route}`, async () => {
      _dbRows =
        route === 'sentiment-summary'
          ? [
              {
                totalCount: '0',
                avgScore: null,
                positiveCount: '0',
                negativeCount: '0',
                neutralCount: '0',
                mixedCount: '0',
              },
            ]
          : [];
      const app = await buildTestApp(signalsRoutes, DEFAULT_PINNED_USER);
      const res = await app.inject({ method: 'GET', url: `/brands/brand-1/${route}` });
      expect(res.statusCode).toBe(200);
    });

    it(`forbids a pinned user from reading another brand's ${route}`, async () => {
      _dbRows = [];
      const app = await buildTestApp(signalsRoutes, DEFAULT_PINNED_USER);
      const res = await app.inject({ method: 'GET', url: `/brands/brand-2/${route}` });
      expect(res.statusCode).toBe(403);
    });

    it(`allows an admin to read any brand's ${route} within the tenant`, async () => {
      _dbRows =
        route === 'sentiment-summary'
          ? [
              {
                totalCount: '0',
                avgScore: null,
                positiveCount: '0',
                negativeCount: '0',
                neutralCount: '0',
                mixedCount: '0',
              },
            ]
          : [];
      const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
      const res = await app.inject({ method: 'GET', url: `/brands/brand-2/${route}` });
      expect(res.statusCode).toBe(200);
    });
  }
});

describe('GET /brands/:id/sentiment-summary', () => {
  it('returns aggregated sentiment data for last 30 days', async () => {
    _dbRows = [
      {
        totalCount: '10',
        avgScore: '0.75',
        positiveCount: '7',
        negativeCount: '1',
        neutralCount: '1',
        mixedCount: '1',
      },
    ];
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
    _dbRows = [
      {
        totalCount: '0',
        avgScore: null,
        positiveCount: '0',
        negativeCount: '0',
        neutralCount: '0',
        mixedCount: '0',
      },
    ];
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
