import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

const whereCalls: unknown[] = [];
let rows: unknown[] = [];
const rowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'insert', 'values', 'update', 'set', 'delete', 'orderBy', 'limit', 'innerJoin']) {
    chain[m] = vi.fn(() => chain);
  }
  chain['where'] = vi.fn((c: unknown) => {
    whereCalls.push(c);
    return chain;
  });
  const next = () => (rowQueue.length ? rowQueue.shift()! : rows);
  chain['returning'] = vi.fn(() => Promise.resolve(next()));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(next()).then(r as never, j as never);
  return {
    db: { get: vi.fn(() => chain) },
    brandEntities: {
      id: 'id', tenantId: 'tenant_id', name: 'name', slug: 'slug',
      parentId: 'parent_id', kind: 'kind', isOwned: 'is_owned',
    },
    tenants: {}, signals: {}, users: {}, sentimentResults: {},
    dimensionScores: {}, sourceConfigs: {}, brandAliases: {},
    conversations: {}, conversationMessages: {}, client: { get: vi.fn() },
  };
});

const brandsRoutes = (await import('../../src/routes/brands.js')).default;
const { wouldCreateCycle, slugify } = await import('../../src/routes/brands.js');

/**
 * The brand/product hierarchy.
 *
 * A product is a brand entity with a parent, so the tree is a self-referencing foreign key — and
 * a self-referencing key admits cycles that Postgres cannot forbid with a simple constraint. A
 * cycle here does not corrupt one row; it makes every tree read run forever. That is what most
 * of this file is about.
 */

const AUTH = { authorization: 'Bearer t' };
const ROOT = { id: 'b-tes', tenantId: 'tenant-1', name: 'Tes', slug: 'tes', parentId: null, kind: 'brand', isOwned: true };
const CHILD = { id: 'p-assess', tenantId: 'tenant-1', name: 'Tes Assess', slug: 'tes-assess', parentId: 'b-tes', kind: 'product', isOwned: true };

beforeEach(() => {
  vi.clearAllMocks();
  whereCalls.length = 0;
  rowQueue.length = 0;
  rows = [];
});

describe('slugify', () => {
  it('makes a URL-safe slug', () => {
    expect(slugify('Tes Assess')).toBe('tes-assess');
    expect(slugify('Blendspace / TES Teach')).toBe('blendspace-tes-teach');
  });

  it('never returns an empty slug', () => {
    /* A name of only punctuation would otherwise produce "", and an entity with an empty slug is
       unroutable and invisible. */
    expect(slugify('***')).toBe('brand');
    expect(slugify('')).toBe('brand');
  });
});

describe('wouldCreateCycle', () => {
  it('refuses an entity as its own parent', async () => {
    expect(await wouldCreateCycle('tenant-1', 'a', 'a')).toBe(true);
  });

  it('refuses a parent that is already a descendant', async () => {
    /* Re-parenting Tes under Tes Assess. The walk from Tes Assess upward reaches Tes, so the
       edge would close a loop. */
    rowQueue.push([{ parentId: 'b-tes' }]);
    expect(await wouldCreateCycle('tenant-1', 'b-tes', 'p-assess')).toBe(true);
  });

  it('allows an unrelated parent', async () => {
    rowQueue.push([{ parentId: null }]);
    expect(await wouldCreateCycle('tenant-1', 'p-assess', 'b-other')).toBe(false);
  });

  it('terminates on data that is ALREADY cyclic', async () => {
    /* The belt-and-braces case. If corrupt data reaches the table by some other path, the walk
       that would have detected it must still finish — otherwise the guard hangs the very request
       that was trying to protect the tree. Every lookup here returns a parent, forever. */
    for (let i = 0; i < 40; i += 1) rowQueue.push([{ parentId: 'loop' }]);
    await expect(wouldCreateCycle('tenant-1', 'x', 'loop')).resolves.toBe(true);
  });
});

describe('GET /brands/tree', () => {
  it('nests children under their parent', async () => {
    rows = [ROOT, CHILD];
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/tree', headers: AUTH });

    expect(res.statusCode).toBe(200);
    const tree = JSON.parse(res.body);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('b-tes');
    expect(tree[0].children[0].id).toBe('p-assess');
  });

  it('surfaces an orphan as a root rather than dropping it', async () => {
    /* A child whose parent is missing — or belongs to another tenant, so the tenant-filtered
       query never returned it — must remain visible. Vanishing would hide a real data fault
       behind an empty space in the UI. */
    rows = [{ ...CHILD, parentId: 'gone' }];
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const tree = JSON.parse((await app.inject({ method: 'GET', url: '/brands/tree', headers: AUTH })).body);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('p-assess');
  });

  it('does not hang on a self-parented row', async () => {
    /* The tree builder must terminate on corrupt data regardless of what the write path allows. */
    rows = [{ ...ROOT, parentId: 'b-tes' }];
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/tree', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(1);
  });

  it('is tenant-scoped', async () => {
    rows = [ROOT];
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'GET', url: '/brands/tree', headers: AUTH });
    expect(JSON.stringify(whereCalls)).toContain('tenant_id');
  });
});

describe('POST /brands', () => {
  it('creates a product beneath a parent, defaulting kind', async () => {
    rowQueue.push([{ id: 'b-tes' }], [CHILD]);
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands',
      headers: AUTH,
      payload: { name: 'Tes Assess', parentId: 'b-tes' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).kind).toBe('product');
  });

  it('refuses a parent from another tenant', async () => {
    /* The lookup is tenant-filtered, so a foreign parent simply is not found. Without that
       filter a caller could attach a product to another tenant's brand — leaking the child into
       that tenant's tree and its portfolio score. */
    rowQueue.push([]);
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/brands',
      headers: AUTH,
      payload: { name: 'Sneaky', parentId: 'other-tenants-brand' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('is refused to a plain user', async () => {
    const app = await buildTestApp(brandsRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'POST',
      url: '/brands',
      headers: AUTH,
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an empty name', async () => {
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/brands', headers: AUTH, payload: { name: '' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /brands/:id', () => {
  it('refuses a re-parent that would create a cycle', async () => {
    rowQueue.push([{ id: 'b-tes' }], [{ id: 'p-assess' }], [{ parentId: 'b-tes' }]);
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/b-tes',
      headers: AUTH,
      payload: { parentId: 'p-assess' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/own ancestor/i);
  });

  it('distinguishes "not supplied" from "promote to root"', async () => {
    /* `undefined` and `null` must not collapse: if they did, a product could never be detached
       from its parent. */
    rowQueue.push([{ id: 'p-assess' }], [{ ...CHILD, parentId: null, kind: 'brand' }]);
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/p-assess',
      headers: AUTH,
      payload: { parentId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).parentId).toBeNull();
  });

  it('renames, and regenerates the slug to match', async () => {
    /* A renamed entity whose slug still says "class-chart" is a link that lies about what it
       points at. The slug is derived, so it moves with the name. */
    rowQueue.push([{ id: 'p1' }], [{ ...CHILD, name: 'Class Charts', slug: 'class-charts' }]);
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/p1',
      headers: AUTH,
      payload: { name: 'Class Charts' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).slug).toBe('class-charts');
  });

  it('trims a name rather than storing the whitespace', async () => {
    rowQueue.push([{ id: 'p1' }], [CHILD]);
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/p1',
      headers: AUTH,
      payload: { name: '  Class Charts  ' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('404s for an entity in another tenant', async () => {
    rowQueue.push([]);
    const app = await buildTestApp(brandsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/theirs',
      headers: AUTH,
      payload: { name: 'Mine now' },
    });
    expect(res.statusCode).toBe(404);
  });
});
