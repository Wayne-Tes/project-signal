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

import { integrationsRoutes } from '../../src/routes/integrations.js';

const now = new Date();
const cfg = { id: 'cfg-1', tenantId: 'tenant-1', brandEntityId: 'brand-1', source: 'google_reviews', isEnabled: true, config: { placeId: 'abc' }, lastFetchedAt: null, createdAt: now, updatedAt: now };

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands/:id/integrations', () => {
  it('returns list of source configs', async () => {
    _dbRows = [cfg];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/integrations' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].source).toBe('google_reviews');
  });

  it('returns 403 for user role', async () => {
    const app = await buildTestApp(integrationsRoutes, { uid: 'u', role: 'user', tenantId: 'tenant-1' });
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/integrations' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /brands/:id/integrations', () => {
  it('creates a new integration and returns it', async () => {
    _dbRows = [cfg];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'google_reviews', config: { placeId: 'abc' }, isEnabled: true },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.data.source).toBe('google_reviews');
  });

  it('returns 400 when source is missing', async () => {
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { config: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when config is not an object', async () => {
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'rss', config: 'not-an-object' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /brands/:id/integrations/:source', () => {
  it('updates an existing integration', async () => {
    _dbRows = [{ ...cfg, isEnabled: false }];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/integrations/google_reviews',
      payload: { isEnabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.isEnabled).toBe(false);
  });

  it('returns 404 when integration does not exist', async () => {
    _dbRows = [];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/integrations/nonexistent',
      payload: { isEnabled: false },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /brands/:id/integrations/:source', () => {
  it('soft-disables an integration', async () => {
    _dbRows = [{ ...cfg, isEnabled: false }];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'DELETE',
      url: '/brands/brand-1/integrations/google_reviews',
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when integration does not exist', async () => {
    _dbRows = [];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'DELETE',
      url: '/brands/brand-1/integrations/nonexistent',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('source validation', () => {
  /**
   * A source with no collector must be refused at configuration time.
   *
   * Before this, any string was accepted. The row was written, the UI listed the source as
   * configured and enabled, and every collection run threw "No adapter for source" — which the
   * dispatcher counts as a failed source and drops. The person who configured it was never told,
   * so the only symptom was a source that produced no signals, which looks exactly like nobody
   * talking about the brand.
   */
  it('rejects a source that is modelled but has no collector', async () => {
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'trustpilot', config: { url: 'https://example.com' } },
    });
    expect(res.statusCode).toBe(400);
    /* The message names what IS available — an error that only says "no" leaves the admin
       guessing which of nine source names the product actually supports. */
    expect(JSON.parse(res.body).error).toContain('rss');
  });

  it('rejects a source that is not a source at all', async () => {
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'definitely-not-a-source', config: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('still accepts every source that does have a collector', async () => {
    const { COLLECTING_SOURCES } = await import('@project-signal/shared-types');
    for (const source of COLLECTING_SOURCES) {
      const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
      const res = await app.inject({
        method: 'POST',
        url: '/brands/brand-1/integrations',
        payload: { source, config: { feedUrl: 'https://example.com/feed' } },
      });
      expect(res.statusCode, source).not.toBe(400);
    }
  });
});
