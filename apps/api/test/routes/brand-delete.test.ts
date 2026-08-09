import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_OWNER, DEFAULT_PINNED_USER } from '../helpers/app.js';

/**
 * `DELETE /brands/:id`.
 *
 * Seven tables reference `brand_entities.id`, and one of them is `users.brand_entity_id` — an
 * AUTHORISATION scope, not a display field. A cascading delete there would silently widen what a
 * person can see. So the route refuses whenever anything real is attached, and these tests exist
 * to prove each refusal actually fires: a guard that is never exercised is a guard that quietly
 * stops working the first time someone reorders the checks.
 *
 * The counts run as a `Promise.all`, so the mock has to serve five results in a fixed order —
 * children, signals, scores, mentions, users. Each test puts the non-zero count in one position
 * and asserts the message names the right thing.
 */

/** Rows served, in order, to successive awaited queries. */
let _queue: unknown[][] = [];
const _deletes: string[] = [];

vi.mock('@project-signal/db', () => {
  /** A fresh chain per call, so five concurrent Promise.all queries do not share a cursor. */
  function makeChain(label = '') {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'from', 'where', 'insert', 'values', 'update', 'set', 'limit']) {
      chain[m] = vi.fn(() => chain);
    }
    chain['then'] = (res: unknown, rej?: unknown) =>
      Promise.resolve(_queue.length ? _queue.shift()! : []).then(res as never, rej as never);
    chain['returning'] = vi.fn(() => Promise.resolve(_queue.length ? _queue.shift()! : []));
    void label;
    return chain;
  }

  const root: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'insert', 'values', 'update', 'set', 'limit']) {
    root[m] = vi.fn(() => makeChain());
  }
  root['delete'] = vi.fn((table: { _name?: string }) => {
    _deletes.push(table?._name ?? 'unknown');
    return makeChain();
  });
  root['then'] = (res: unknown, rej?: unknown) => Promise.resolve([]).then(res as never, rej as never);

  const table = (name: string) =>
    new Proxy({ _name: name } as Record<string, unknown>, {
      get: (t, p) => (p in t ? t[p as string] : { _col: String(p), _table: name }),
    });

  return {
    db: { get: vi.fn(() => root) },
    client: { get: vi.fn() },
    brandEntities: table('brand_entities'),
    brandAliases: table('brand_aliases'),
    dimensionScores: table('dimension_scores'),
    scanRuns: table('scan_runs'),
    signalMentions: table('signal_mentions'),
    signals: table('signals'),
    sourceConfigs: table('source_configs'),
    users: table('users'),
    tenants: table('tenants'),
    sentimentResults: table('sentiment_results'),
    conversations: table('conversations'),
    conversationMessages: table('conversation_messages'),
  };
});

import brandsRoutes from '../../src/routes/brands.js';

/** The entity lookup, then five dependency counts, all clear. */
function nothingAttached(): void {
  _queue = [[{ id: 'brand-9' }], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }]];
}

/** As above, but with `n` rows in the `position`-th dependency check (0-based). */
function attached(position: number, n = 3): void {
  const counts = [0, 0, 0, 0, 0].map((_, i) => [{ n: i === position ? n : 0 }]);
  _queue = [[{ id: 'brand-9' }], ...counts];
}

beforeEach(() => {
  _queue = [];
  _deletes.length = 0;
  vi.clearAllMocks();
});

describe('DELETE /brands/:id', () => {
  it('deletes an entity that has nothing attached', async () => {
    nothingAttached();
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-9' });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('removes the entity AND the configuration that only made sense with it', async () => {
    /* Aliases, feeds and scan history belong to the entity and mean nothing without it. Leaving
       them behind would be orphaned rows referencing an id that no longer exists — which is also
       a foreign-key violation, so the delete would fail outright. */
    nothingAttached();
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    await app.inject({ method: 'DELETE', url: '/brands/brand-9' });

    expect(_deletes).toEqual(['scan_runs', 'source_configs', 'brand_aliases', 'brand_entities']);
  });

  it('deletes the entity LAST, after the rows that point at it', async () => {
    /* Order is not cosmetic. Removing the parent row first violates every foreign key still
       referencing it, and Postgres rejects the statement. */
    nothingAttached();
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    await app.inject({ method: 'DELETE', url: '/brands/brand-9' });

    expect(_deletes[_deletes.length - 1]).toBe('brand_entities');
  });

  it('refuses when it still has products underneath it', async () => {
    attached(0);
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-9' });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/products or sub-brands/i);
    expect(_deletes, 'nothing may be deleted once a blocker fires').toEqual([]);
  });

  it('refuses when signals have been collected, and says to rename instead', async () => {
    /* The case that prompted this whole route: a product named wrongly. Renaming is the remedy —
       deleting would throw away everything collected under the wrong name, which is exactly the
       history the user wanted to keep. The message has to say so. */
    attached(1);
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-9' });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/rename it instead/i);
    expect(_deletes).toEqual([]);
  });

  it('refuses when it has been scored', async () => {
    attached(2);
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-9' });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/been scored/i);
  });

  it('refuses when it is mentioned in collected signals', async () => {
    attached(3);
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-9' });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/mentioned/i);
  });

  it('refuses when a user is assigned to it', async () => {
    /* The dangerous one. `users.brand_entity_id` is what scopes a person to a single brand; if
       this delete went through, that column would point at nothing and the check that reads it
       would stop constraining anyone. */
    attached(4);
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-9' });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/user is assigned/i);
    expect(_deletes).toEqual([]);
  });

  it('reports the FIRST blocker when several apply', async () => {
    _queue = [[{ id: 'brand-9' }], [{ n: 2 }], [{ n: 90 }], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }]];
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-9' });

    expect(JSON.parse(res.body).message).toMatch(/products or sub-brands/i);
  });

  it('404s for an entity in another tenant rather than 403', async () => {
    /* Same non-answer either way. A 403 would confirm the id exists, which turns this endpoint
       into a way to enumerate other tenants' brands. */
    _queue = [[]];
    const app = await buildTestApp(brandsRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/someone-elses' });

    expect(res.statusCode).toBe(404);
    expect(_deletes).toEqual([]);
  });

  it('refuses a plain user, who may not delete anything', async () => {
    nothingAttached();
    const app = await buildTestApp(brandsRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'DELETE', url: '/brands/brand-1' });

    expect(res.statusCode).toBe(403);
    expect(_deletes).toEqual([]);
  });
});
