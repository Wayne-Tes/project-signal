import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from '../helpers/app.js';

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

import brandsRoutes from '../../src/routes/brands.js';

const now = new Date();
const brand1 = { id: 'brand-1', tenantId: 'tenant-1', name: 'Acme', slug: 'acme', isOwned: true, createdAt: now, updatedAt: now };
const brand2 = { id: 'brand-2', tenantId: 'tenant-1', name: 'Beta', slug: 'beta', isOwned: false, createdAt: now, updatedAt: now };

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands', () => {
  it('returns all brands for admin role', async () => {
    _dbRows = [brand1, brand2];
    const app = await buildTestApp(brandsRoutes, { uid: 'u', role: 'admin', tenantId: 'tenant-1' });
    const res = await app.inject({ method: 'GET', url: '/brands' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
  });

  it('filters to assigned brand for user role', async () => {
    _dbRows = [brand1];
    const app = await buildTestApp(brandsRoutes, { uid: 'u', role: 'user', tenantId: 'tenant-1', brandEntityId: 'brand-1' });
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
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('brand-1');
    expect(body.name).toBe('Acme');
  });

  it('returns 404 when brand is not found', async () => {
    _dbRows = [];
    const app = await buildTestApp(brandsRoutes);
    const res = await app.inject({ method: 'GET', url: '/brands/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});
