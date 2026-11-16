import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN } from '../helpers/app.js';

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
    'delete',
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
    brandAliases: {},
    signals: {},
    users: {},
    sentimentResults: {},
    dimensionScores: {},
    sourceConfigs: {},
    client: { get: vi.fn() },
  };
});

import { aliasesRoutes } from '../../src/routes/aliases.js';

const now = new Date();
const alias = {
  id: 'aa111111-1111-4111-8111-111111111111',
  tenantId: '11111111-1111-4111-8111-111111111111',
  brandEntityId: 'b1111111-1111-4111-8111-111111111111',
  alias: 'CDN',
  createdAt: now,
};

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands/:id/aliases', () => {
  it('returns list of aliases', async () => {
    _dbRows = [alias];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].alias).toBe('CDN');
  });

  it('returns 403 for user role', async () => {
    const app = await buildTestApp(aliasesRoutes, {
      uid: 'u',
      role: 'user',
      tenantId: '11111111-1111-4111-8111-111111111111',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /brands/:id/aliases', () => {
  it('creates a new alias and returns it', async () => {
    _dbRows = [alias];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases',
      payload: { alias: 'CDN' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.alias).toBe('CDN');
  });

  it('returns 400 when alias is missing or blank', async () => {
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases',
      payload: { alias: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 when the alias already exists', async () => {
    // The brand belongs to the caller; the insert then conflicts and returns nothing.
    _dbRowQueue.push([{ id: alias.brandEntityId }], []);
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases',
      payload: { alias: 'CDN' },
    });
    expect(res.statusCode).toBe(409);
  });

  it("404s — and writes nothing — for a brand outside the caller's tenant", async () => {
    /* The insert stamps the CALLER's tenant with the URL's brand. Without the ownership check an
       admin could attach an alias to another tenant's brand by pasting its id, and aliases drive
       mention matching — so it would quietly change how that brand is read. */
    _dbRowQueue.push([]);
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { insert: ReturnType<typeof vi.fn> };
    const res = await app.inject({
      method: 'POST',
      url: '/brands/f0000000-0000-4000-8000-00000000f0e2/aliases',
      payload: { alias: 'CDN' },
    });
    expect(res.statusCode).toBe(404);
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it('strips undeclared body fields and rejects a non-string alias', async () => {
    _dbRows = [alias];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const ok = await app.inject({
      method: 'POST',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases',
      payload: { alias: 'CDN', tenantId: '22222222-2222-4222-8222-222222222222' },
    });
    expect(ok.statusCode).toBe(201);
    const bad = await app.inject({
      method: 'POST',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases',
      payload: { alias: 42 },
    });
    // Coerced to "42" by Fastify's ajv (coerceTypes), which is a valid alias; an object is not.
    expect([201, 400]).toContain(bad.statusCode);
    const worse = await app.inject({
      method: 'POST',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases',
      payload: { alias: { nested: true } },
    });
    expect(worse.statusCode).toBe(400);
  });

  it('rejects a malformed brand id at the schema', async () => {
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/aliases',
      payload: { alias: 'CDN' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /brands/:id/aliases/:aliasId', () => {
  it('removes an alias', async () => {
    _dbRows = [alias];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'DELETE',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases/aa111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when the alias does not exist', async () => {
    _dbRows = [];
    const app = await buildTestApp(aliasesRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'DELETE',
      url: '/brands/b1111111-1111-4111-8111-111111111111/aliases/00000000-0000-4000-8000-00000000dead',
    });
    expect(res.statusCode).toBe(404);
  });
});
