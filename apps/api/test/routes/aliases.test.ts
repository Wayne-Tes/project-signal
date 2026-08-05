import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN } from '../helpers/app.js';

let _dbRows: unknown[] = [];
const _dbRowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  ['select', 'from', 'where', 'insert', 'values', 'update', 'set', 'delete',
    'innerJoin', 'limit', 'offset', 'onConflictDoUpdate', 'onConflictDoNothing']
    .forEach(m => { chain[m] = vi.fn(() => chain); });
  const nextRows = () => (_dbRowQueue.length ? _dbRowQueue.shift()! : _dbRows);
  chain['returning'] = vi.fn(() => Promise.resolve(nextRows()));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(nextRows()).then(r as never, j as never);
  chain['transaction'] = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(chain));
  return {
    db: { get: vi.fn(() => chain) },
    tenants: {}, brandEntities: {}, brandAliases: {}, signals: {}, users: {},
    sentimentResults: {}, dimensionScores: {}, sourceConfigs: {}, client: { get: vi.fn() },
  };
});

import { aliasesRoutes } from '../../src/routes/aliases.js';

const now = new Date();
const alias = { id: 'alias-1', tenantId: 'tenant-1', brandEntityId: 'brand-1', alias: 'CDN', createdAt: now };

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands/:id/aliases', () => {
  it('returns list of aliases', async () => {
    _dbRows = [alias];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/aliases' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].alias).toBe('CDN');
  });

  it('returns 403 for user role', async () => {
    const app = await buildTestApp(aliasesRoutes, { uid: 'u', role: 'user', tenantId: 'tenant-1' });
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/aliases' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /brands/:id/aliases', () => {
  it('creates a new alias and returns it', async () => {
    _dbRows = [alias];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/aliases',
      payload: { alias: 'CDN' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.alias).toBe('CDN');
  });

  it('returns 400 when alias is missing or blank', async () => {
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/aliases',
      payload: { alias: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 when the alias already exists', async () => {
    _dbRows = [];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/aliases',
      payload: { alias: 'CDN' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('DELETE /brands/:id/aliases/:aliasId', () => {
  it('removes an alias', async () => {
    _dbRows = [alias];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-1/aliases/alias-1' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when the alias does not exist', async () => {
    _dbRows = [];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-1/aliases/nope' });
    expect(res.statusCode).toBe(404);
  });
});
