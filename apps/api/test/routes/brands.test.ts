import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_OWNER, DEFAULT_PINNED_USER } from '../helpers/app.js';

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

import brandsRoutes from '../../src/routes/brands.js';

const now = new Date();
const brand1 = {
  id: 'b1111111-1111-4111-8111-111111111111',
  tenantId: '11111111-1111-4111-8111-111111111111',
  name: 'Acme',
  slug: 'acme',
  isOwned: true,
  createdAt: now,
  updatedAt: now,
};
const brand2 = {
  id: 'b2222222-2222-4222-8222-222222222222',
  tenantId: '11111111-1111-4111-8111-111111111111',
  name: 'Beta',
  slug: 'beta',
  isOwned: false,
  createdAt: now,
  updatedAt: now,
};

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands', () => {
  it('returns all brands for admin role', async () => {
    _dbRows = [brand1, brand2];
    const app = await buildTestApp(brandsRoutes, {
      uid: 'u',
      role: 'admin',
      tenantId: '11111111-1111-4111-8111-111111111111',
    });
    const res = await app.inject({ method: 'GET', url: '/brands' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
  });

  it('filters to assigned brand for user role', async () => {
    _dbRows = [brand1];
    const app = await buildTestApp(brandsRoutes, {
      uid: 'u',
      role: 'user',
      tenantId: '11111111-1111-4111-8111-111111111111',
      brandEntityId: 'b1111111-1111-4111-8111-111111111111',
    });
    const res = await app.inject({ method: 'GET', url: '/brands' });
    expect(res.statusCode).toBe(200);
  });

  it('returns empty array when no brands', async () => {
    _dbRows = [];
    const app = await buildTestApp(brandsRoutes);
    const res = await app.inject({ method: 'GET', url: '/brands' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });
});

describe('GET /brands/:id', () => {
  it('returns a brand by id', async () => {
    _dbRows = [brand1];
    const app = await buildTestApp(brandsRoutes);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('b1111111-1111-4111-8111-111111111111');
    expect(body.name).toBe('Acme');
  });

  it('returns 404 when brand is not found', async () => {
    _dbRows = [];
    const app = await buildTestApp(brandsRoutes);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/00000000-0000-4000-8000-00000000dead',
    });
    expect(res.statusCode).toBe(404);
  });

  it('allows a pinned user to read their own brand', async () => {
    _dbRows = [brand1];
    const app = await buildTestApp(brandsRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a pinned user reading a sibling brand in the same tenant', async () => {
    // The row would have been returned — the tenant filter does not exclude it — so a 403
    // here proves the guard, not an empty result set.
    _dbRows = [brand2];
    const app = await buildTestApp(brandsRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b2222222-2222-4222-8222-222222222222',
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not constrain an unpinned user', async () => {
    // Matches GET /brands, which returns every brand in the tenant when no pin is set.
    _dbRows = [brand2];
    const app = await buildTestApp(brandsRoutes, {
      uid: 'u',
      role: 'user',
      tenantId: '11111111-1111-4111-8111-111111111111',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b2222222-2222-4222-8222-222222222222',
    });
    expect(res.statusCode).toBe(200);
  });

  it('does not constrain owner or admin', async () => {
    _dbRows = [brand2];
    const owner = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    expect(
      (await owner.inject({ method: 'GET', url: '/brands/b2222222-2222-4222-8222-222222222222' }))
        .statusCode,
    ).toBe(200);

    _dbRows = [brand2];
    const admin = await buildTestApp(brandsRoutes);
    expect(
      (await admin.inject({ method: 'GET', url: '/brands/b2222222-2222-4222-8222-222222222222' }))
        .statusCode,
    ).toBe(200);
  });
});
