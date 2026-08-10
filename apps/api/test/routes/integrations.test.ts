import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

/**
 * Integrations — the feeds configured for a brand.
 *
 * THE REGRESSION THESE TESTS EXIST FOR. A brand could hold one feed of each source type, because
 * `source_configs` carried `unique(brand_entity_id, source)` and POST upserted onto it. Adding a
 * second RSS feed did not fail — it OVERWROTE the first, and the list then showed one row as
 * though that had always been the whole configuration. A brand tracking both "Tes Global" and
 * "Tes MyConcern" on Google News could only ever have one of them, and nothing said which had
 * been lost. Every test in this file passed throughout, because they all used one feed.
 *
 * So the first thing asserted here is the thing that was impossible: two feeds of the same type,
 * both created, both returned.
 */

let _dbRows: unknown[] = [];
const _dbRowQueue: unknown[][] = [];
const _ops: string[] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of [
    'select', 'from', 'where', 'insert', 'values', 'update', 'set',
    'innerJoin', 'leftJoin', 'groupBy', 'limit', 'offset',
    'onConflictDoUpdate', 'onConflictDoNothing',
  ]) {
    chain[m] = vi.fn(() => chain);
  }
  chain['delete'] = vi.fn(() => {
    _ops.push('delete');
    return chain;
  });
  const nextRows = () => (_dbRowQueue.length ? _dbRowQueue.shift()! : _dbRows);
  chain['returning'] = vi.fn(() => Promise.resolve(nextRows()));
  chain['then'] = (r: unknown, j?: unknown) =>
    Promise.resolve(nextRows()).then(r as never, j as never);
  chain['transaction'] = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(chain));
  return {
    db: { get: vi.fn(() => chain) },
    tenants: {}, brandEntities: {}, signals: {}, users: {},
    sentimentResults: {}, dimensionScores: {}, sourceConfigs: {}, client: { get: vi.fn() },
  };
});

import { integrationsRoutes } from '../../src/routes/integrations.js';

const now = new Date();

function feed(over: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    tenantId: 'tenant-1',
    brandEntityId: 'brand-1',
    source: 'rss',
    label: null,
    isEnabled: true,
    config: { feedUrl: 'https://a.example/feed.xml' },
    lastFetchedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

/** POST reads existing feeds first, then inserts. Two queued results, in that order. */
function postSequence(existing: unknown[], created: unknown) {
  _dbRowQueue.length = 0;
  _dbRowQueue.push(existing, [created]);
}

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  _ops.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands/:id/integrations', () => {
  it('returns every configured feed', async () => {
    _dbRows = [feed(), feed({ id: 'cfg-2', config: { feedUrl: 'https://b.example/feed.xml' } })];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/integrations' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(2);
  });

  it('is refused to a plain user', async () => {
    const app = await buildTestApp(integrationsRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/integrations' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /brands/:id/integrations', () => {
  it('adds a SECOND feed of a type that already has one', async () => {
    /* The whole point. Two Google News searches — one per product — on the same brand. This was
       impossible: the second silently replaced the first. */
    postSequence(
      [{ id: 'cfg-1', config: { feedUrl: 'https://news.google.com/rss/search?q=%22Tes+Global%22' } }],
      feed({ id: 'cfg-2', config: { feedUrl: 'https://news.google.com/rss/search?q=%22Tes+MyConcern%22' } }),
    );
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: {
        source: 'rss',
        config: { feedUrl: 'https://news.google.com/rss/search?q=%22Tes+MyConcern%22' },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.id).toBe('cfg-2');
  });

  it('returns 201, not 200 — this is no longer an upsert', async () => {
    postSequence([], feed());
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'rss', config: { feedUrl: 'https://a.example/feed.xml' } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('stores a label', async () => {
    postSequence([], feed({ label: 'Google News — MyConcern' }));
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: {
        source: 'rss',
        label: 'Google News — MyConcern',
        config: { feedUrl: 'https://a.example/feed.xml' },
      },
    });
    expect(JSON.parse(res.body).data.label).toBe('Google News — MyConcern');
  });

  it('refuses an EXACT duplicate, and says so', async () => {
    /* A double-click, not a second feed. Collecting the same URL twice doubles that feed's cost
       for nothing. */
    postSequence([{ id: 'cfg-1', config: { feedUrl: 'https://a.example/feed.xml' } }], feed());
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'rss', config: { feedUrl: 'https://a.example/feed.xml' } },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/already configured/i);
  });

  it('treats key order as irrelevant when detecting a duplicate', async () => {
    /* `{appId, country}` and `{country, appId}` are the same feed. A JSON.stringify comparison
       would call them different and let the duplicate through. */
    postSequence([{ id: 'cfg-1', config: { country: 'gb', appId: '284882215' } }], feed());
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'app_store', config: { appId: '284882215', country: 'gb' } },
    });

    expect(res.statusCode).toBe(409);
  });

  it('accepts reddit', async () => {
    postSequence([], feed({ source: 'reddit', config: { query: '"Tes MyConcern"' } }));
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'reddit', config: { query: '"Tes MyConcern"', subreddit: 'TeachingUK' } },
    });

    expect(res.statusCode).toBe(201);
  });

  it('still refuses a source with no collector behind it', async () => {
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'trustpilot', config: { x: 'y' } },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/no collector/i);
  });

  it('requires a config object', async () => {
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands/brand-1/integrations',
      payload: { source: 'rss' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /brands/:id/integrations/:configId', () => {
  it('updates one feed by its own id', async () => {
    _dbRows = [feed({ isEnabled: false })];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/integrations/cfg-1',
      payload: { isEnabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.isEnabled).toBe(false);
  });

  it('renames a feed', async () => {
    _dbRows = [feed({ label: 'Renamed' })];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/integrations/cfg-1',
      payload: { label: 'Renamed' },
    });
    expect(JSON.parse(res.body).data.label).toBe('Renamed');
  });

  it('404s for a feed that is not there', async () => {
    _dbRows = [];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/integrations/nope',
      payload: { isEnabled: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /brands/:id/integrations/:configId', () => {
  it('really deletes the row', async () => {
    /* It used to soft-disable, which was defensible when a brand held at most one feed per type.
       With a dozen feeds, several added by mistake, a delete that leaves every one of them on
       screen forever makes the panel unusable — and offers no way to remove a mistyped URL.
       Nothing collected is lost: `signals.source_config_id` is ON DELETE SET NULL. */
    _dbRows = [feed()];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-1/integrations/cfg-1' });

    expect(res.statusCode).toBe(200);
    expect(_ops).toContain('delete');
  });

  it('404s for a feed that is not there', async () => {
    _dbRows = [];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-1/integrations/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('is refused to a plain user', async () => {
    _dbRows = [feed()];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-1/integrations/cfg-1' });

    expect(res.statusCode).toBe(403);
    expect(_ops).toEqual([]);
  });
});

describe('GET /brands/:id/integrations/stats', () => {
  it('reports what each feed has actually produced', async () => {
    _dbRows = [
      { id: 'cfg-1', source: 'rss', label: 'Tes Global', isEnabled: true, lastFetchedAt: now, signalCount: 412, latestSignalAt: now },
      { id: 'cfg-2', source: 'rss', label: 'Tes MyConcern', isEnabled: true, lastFetchedAt: now, signalCount: 0, latestSignalAt: null },
    ];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/integrations/stats' });

    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).data;
    /* The zero row is the important one. A feed that has collected nothing is the whole reason
       this endpoint exists — a dead feed and a quiet market look identical without it — and an
       inner join would have dropped it. */
    expect(rows.find((r: { id: string }) => r.id === 'cfg-2').signalCount).toBe(0);
  });

  it('does not get swallowed by the :configId route', async () => {
    /* `/integrations/stats` and `/integrations/:configId` overlap. Fastify gives static segments
       priority, so this works — but it works by a router rule, not by anything visible in the
       file, and reordering the registrations would look harmless. */
    _dbRows = [{ id: 'cfg-1', source: 'rss', label: null, isEnabled: true, lastFetchedAt: null, signalCount: 3, latestSignalAt: null }];
    const app = await buildTestApp(integrationsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/integrations/stats' });

    expect(JSON.parse(res.body).data[0]).toHaveProperty('signalCount');
  });
});
