import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import {
  brandAliases,
  brandEntities,
  client,
  db,
  dimensionScores,
  scanRuns,
  signals,
  sourceConfigs,
  tenants,
  trackedActions,
  users,
} from '@project-signal/db';
import { buildApp } from '../../src/app.js';
import { devToken } from '../../src/plugins/auth.js';

/**
 * The API against a REAL Postgres, through the REAL application wiring (`buildApp`).
 *
 * Every route unit test stubs drizzle, so none can prove that a WHERE clause filters by tenant,
 * that a uuid column rejects garbage, or that a foreign key fires. Those are exactly the defect
 * classes this API has shipped (KNOWN-GAPS #5, #5b, #6, #12, and the mass assignment fixed with
 * this suite). Here the database answers for itself.
 *
 * Two tenants, A and B. A has an owned brand, a pinned plain user and an admin; B has a brand,
 * an admin and a user. Every cross-tenant assertion checks the DATABASE afterwards, not just the
 * status code — a 404 that still wrote the row would be a pass for the wrong reason.
 */

let app: FastifyInstance;

const ids = {
  tenantA: '',
  tenantB: '',
  brandA: '',
  brandA2: '',
  brandB: '',
  adminA: '',
  userA: '',
  adminB: '',
};

const AUTH = (token: string) => ({ authorization: `Bearer ${token}` });
let adminAToken = '';
let ownerAToken = '';
let pinnedUserAToken = '';

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();

  const database = db.get();
  const [a] = await database
    .insert(tenants)
    .values({ name: 'Tenant A', slug: 'tenant-a' })
    .returning();
  const [b] = await database
    .insert(tenants)
    .values({ name: 'Tenant B', slug: 'tenant-b' })
    .returning();
  ids.tenantA = a!.id;
  ids.tenantB = b!.id;

  const [brandA] = await database
    .insert(brandEntities)
    .values({ tenantId: ids.tenantA, name: 'Alpha', slug: 'alpha', isOwned: true })
    .returning();
  const [brandA2] = await database
    .insert(brandEntities)
    .values({ tenantId: ids.tenantA, name: 'Alpha Rival', slug: 'alpha-rival', isOwned: false })
    .returning();
  const [brandB] = await database
    .insert(brandEntities)
    .values({ tenantId: ids.tenantB, name: 'Bravo', slug: 'bravo', isOwned: true })
    .returning();
  ids.brandA = brandA!.id;
  ids.brandA2 = brandA2!.id;
  ids.brandB = brandB!.id;

  const [adminA] = await database
    .insert(users)
    .values({ cognitoSub: 'int-admin-a', tenantId: ids.tenantA, role: 'admin' })
    .returning();
  const [userA] = await database
    .insert(users)
    .values({
      cognitoSub: 'int-user-a',
      tenantId: ids.tenantA,
      role: 'user',
      brandEntityId: ids.brandA,
    })
    .returning();
  const [adminB] = await database
    .insert(users)
    .values({ cognitoSub: 'int-admin-b', tenantId: ids.tenantB, role: 'admin' })
    .returning();
  ids.adminA = adminA!.id;
  ids.userA = userA!.id;
  ids.adminB = adminB!.id;

  adminAToken = devToken({ role: 'admin', tenantId: ids.tenantA, uid: 'int-admin-a' });
  ownerAToken = devToken({ role: 'owner', tenantId: ids.tenantA, uid: 'int-owner-a' });
  pinnedUserAToken = devToken({
    role: 'user',
    tenantId: ids.tenantA,
    brandEntityId: ids.brandA,
    uid: 'int-user-a',
  });
});

afterAll(async () => {
  await app?.close();
  await client.get().end();
});

describe('readiness, against a real database', () => {
  it('/ready reports ok when Postgres answers', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
  });
});

describe('local sign-in, end to end', () => {
  it("signs in a seeded user and the token carries that row's claims", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/local/sign-in',
      payload: { username: 'int-user-a', password: 'integration-test-password' },
    });
    expect(res.statusCode).toBe(200);
    const { token, user } = JSON.parse(res.body);
    expect(user).toMatchObject({ role: 'user', tenantId: ids.tenantA, brandEntityId: ids.brandA });

    // …and that token works against a protected route, scoped as the row says.
    const brands = await app.inject({ method: 'GET', url: '/brands', headers: AUTH(token) });
    expect(JSON.parse(brands.body).map((b: { id: string }) => b.id)).toEqual([ids.brandA]);
  });

  it('refuses a wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/local/sign-in',
      payload: { username: 'int-user-a', password: 'not-the-password' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('THE MASS-ASSIGNMENT DEFECT — PATCH /admin/users/:id', () => {
  it('cannot move a user into another tenant or onto another identity', async () => {
    /* Before the fix: the body was spread into the UPDATE and the schema let undeclared keys
       through, so this request moved admin A into tenant B (and the claims call would then have
       minted admin claims there). */
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${ids.adminA}`,
      headers: AUTH(adminAToken),
      payload: { role: 'admin', tenantId: ids.tenantB, cognitoSub: 'int-admin-b-hijack' },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await db.get().select().from(users).where(eq(users.id, ids.adminA));
    expect(row!.tenantId).toBe(ids.tenantA);
    expect(row!.cognitoSub).toBe('int-admin-a');
  });

  it("cannot pin a user to another tenant's brand", async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${ids.userA}`,
      headers: AUTH(adminAToken),
      payload: { brandEntityId: ids.brandB },
    });
    expect(res.statusCode).toBe(400);
    const [row] = await db.get().select().from(users).where(eq(users.id, ids.userA));
    expect(row!.brandEntityId).toBe(ids.brandA);
  });

  it('can clear a pin with null', async () => {
    const [temp] = await db
      .get()
      .insert(users)
      .values({
        cognitoSub: 'int-temp',
        tenantId: ids.tenantA,
        role: 'user',
        brandEntityId: ids.brandA,
      })
      .returning();
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${temp!.id}`,
      headers: AUTH(adminAToken),
      payload: { brandEntityId: null },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db.get().select().from(users).where(eq(users.id, temp!.id));
    expect(row!.brandEntityId).toBeNull();
  });

  it("an admin cannot reach another tenant's user at all", async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${ids.adminB}`,
      headers: AUTH(adminAToken),
      payload: { role: 'user' },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await db.get().select().from(users).where(eq(users.id, ids.adminB));
    expect(row!.role).toBe('admin');
  });
});

describe('tenant isolation on reads', () => {
  it("GET /brands returns only the caller's tenant", async () => {
    const res = await app.inject({ method: 'GET', url: '/brands', headers: AUTH(adminAToken) });
    const got = JSON.parse(res.body)
      .map((b: { id: string }) => b.id)
      .sort();
    expect(got).toEqual([ids.brandA, ids.brandA2].sort());
  });

  it("GET /brands/:id 404s for another tenant's brand", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/brands/${ids.brandB}`,
      headers: AUTH(adminAToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /brands/tree gives a pinned user only their brand — not the tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/brands/tree',
      headers: AUTH(pinnedUserAToken),
    });
    const tree = JSON.parse(res.body) as { id: string }[];
    expect(tree.map((n) => n.id)).toEqual([ids.brandA]);
  });

  it("a pinned user is refused a sibling brand's data", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/brands/${ids.brandA2}/signals`,
      headers: AUTH(pinnedUserAToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("signals of another tenant's brand are invisible through any brand id", async () => {
    await db.get().insert(signals).values({
      tenantId: ids.tenantB,
      brandEntityId: ids.brandB,
      source: 'rss',
      sourceUrl: 'https://example.test/b-only',
      rawStorageRef: 's3://bucket/b-only.json',
      publishedAt: new Date(),
    });
    const res = await app.inject({
      method: 'GET',
      url: `/brands/${ids.brandB}/signals`,
      headers: AUTH(adminAToken),
    });
    // The route's tenant filter answers with nothing rather than tenant B's rows.
    expect(res.body).not.toContain('b-only');
  });
});

describe('tenant isolation on writes — a foreign brand id is refused and NOTHING is written', () => {
  it('aliases', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/brands/${ids.brandB}/aliases`,
      headers: AUTH(adminAToken),
      payload: { alias: 'hijack' },
    });
    expect(res.statusCode).toBe(404);
    const rows = await db
      .get()
      .select()
      .from(brandAliases)
      .where(eq(brandAliases.brandEntityId, ids.brandB));
    expect(rows).toHaveLength(0);
  });

  it('integrations (feeds)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/brands/${ids.brandB}/integrations`,
      headers: AUTH(adminAToken),
      payload: { source: 'rss', config: { feedUrl: 'https://example.test/feed.xml' } },
    });
    expect(res.statusCode).toBe(404);
    const rows = await db
      .get()
      .select()
      .from(sourceConfigs)
      .where(eq(sourceConfigs.brandEntityId, ids.brandB));
    expect(rows).toHaveLength(0);
  });

  it('scans', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/brands/${ids.brandB}/scan`,
      headers: AUTH(adminAToken),
    });
    expect(res.statusCode).toBe(404);
    const rows = await db
      .get()
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.brandEntityId, ids.brandB));
    expect(rows).toHaveLength(0);
  });
});

describe('input validation reaches the client as 4xx, never as a 500 with SQL', () => {
  it('a malformed id is a 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/brands/not-a-uuid',
      headers: AUTH(adminAToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('Failed query');
  });

  it('a malformed date is a 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/brands/${ids.brandA}/dimension-scores?from=yesterday`,
      headers: AUTH(adminAToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('a real unique violation from Postgres is a 409 with no SQL in it', async () => {
    // Two users with the same identity: users.cognito_sub is unique.
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: AUTH(adminAToken),
      payload: { cognitoSub: 'int-admin-a', role: 'user' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).not.toContain('Failed query');
    expect(res.body).not.toContain('cognito_sub');
  });
});

describe('POST /admin/users takes the tenant from the caller', () => {
  it("lands an admin's new user in the admin's own tenant when none is named", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: AUTH(adminAToken),
      payload: { cognitoSub: 'int-new-a', role: 'user' },
    });
    expect(res.statusCode).toBe(201);
    const [row] = await db.get().select().from(users).where(eq(users.cognitoSub, 'int-new-a'));
    expect(row?.tenantId).toBe(ids.tenantA);
  });

  it('refuses an admin naming another tenant, and writes nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: AUTH(adminAToken),
      payload: { cognitoSub: 'int-hijack-b', role: 'user', tenantId: ids.tenantB },
    });
    expect(res.statusCode).toBe(403);
    const rows = await db.get().select().from(users).where(eq(users.cognitoSub, 'int-hijack-b'));
    expect(rows).toHaveLength(0);
  });
});

describe('territory lens and index history, against real SQL', () => {
  it("lists a brand's territories from feeds and signals, tenant-scoped, without 'all'", async () => {
    const database = db.get();
    await database.insert(sourceConfigs).values({
      tenantId: ids.tenantA,
      brandEntityId: ids.brandA,
      source: 'rss',
      territory: 'GB',
      config: { feedUrl: 'https://example.test/terr.xml' },
    });
    await database.insert(signals).values({
      tenantId: ids.tenantA,
      brandEntityId: ids.brandA,
      source: 'rss',
      territory: 'AU',
      sourceUrl: 'https://example.test/terr-a',
      rawStorageRef: 's3://bucket/terr-a.json',
      publishedAt: new Date(),
    });
    // Tenant B's territory must never leak into tenant A's lens.
    await database.insert(signals).values({
      tenantId: ids.tenantB,
      brandEntityId: ids.brandB,
      source: 'rss',
      territory: 'NZ',
      sourceUrl: 'https://example.test/terr-b',
      rawStorageRef: 's3://bucket/terr-b.json',
      publishedAt: new Date(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/brands/${ids.brandA}/territories`,
      headers: AUTH(pinnedUserAToken),
    });
    expect(res.statusCode).toBe(200);
    const { territories } = res.json() as { territories: string[] };
    expect(territories).toEqual(expect.arrayContaining(['AU', 'GB']));
    expect(territories).not.toContain('NZ');
    expect(territories).not.toContain('all');
  });

  it('returns the weighted composite per day from real dimension_scores rows', async () => {
    const database = db.get();
    await database
      .update(brandEntities)
      .set({ dimensionWeights: { trust: 3, quality: 1 } })
      .where(eq(brandEntities.id, ids.brandA));
    const today = new Date().toISOString().slice(0, 10);
    await database.insert(dimensionScores).values([
      {
        tenantId: ids.tenantA,
        brandEntityId: ids.brandA,
        date: today,
        dimension: 'trust',
        territory: 'all',
        score: 80,
        signalCount: 3,
      },
      {
        tenantId: ids.tenantA,
        brandEntityId: ids.brandA,
        date: today,
        dimension: 'quality',
        territory: 'all',
        score: 40,
        signalCount: 1,
      },
      // A per-territory row for the same day must not be mixed into the aggregate.
      {
        tenantId: ids.tenantA,
        brandEntityId: ids.brandA,
        date: today,
        dimension: 'trust',
        territory: 'GB',
        score: 0,
        signalCount: 9,
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/brands/${ids.brandA}/score-history`,
      headers: AUTH(adminAToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ date: today, score: 70, signalCount: 4 }]);

    // Leave brand A as the later suites expect it.
    await database.delete(dimensionScores).where(eq(dimensionScores.brandEntityId, ids.brandA));
    await database
      .update(brandEntities)
      .set({ dimensionWeights: null })
      .where(eq(brandEntities.id, ids.brandA));
  });
});

describe('DELETE /brands/:id against real foreign keys', () => {
  let brand = '';

  beforeEach(async () => {
    const [row] = await db
      .get()
      .insert(brandEntities)
      .values({
        tenantId: ids.tenantA,
        name: 'Disposable',
        slug: `disposable-${Date.now()}`,
        isOwned: true,
      })
      .returning();
    brand = row!.id;
    await db
      .get()
      .insert(brandAliases)
      .values({ tenantId: ids.tenantA, brandEntityId: brand, alias: 'D' });
    await db
      .get()
      .insert(sourceConfigs)
      .values({
        tenantId: ids.tenantA,
        brandEntityId: brand,
        source: 'rss',
        config: { feedUrl: 'https://example.test/d.xml' },
      });
  });

  it('refuses a brand with a committed roadmap action, and leaves its configuration intact', async () => {
    /* The regression: tracked_actions was not a blocker, so this deleted the feeds and aliases
       and THEN failed on the foreign key. */
    await db
      .get()
      .insert(trackedActions)
      .values({ tenantId: ids.tenantA, brandEntityId: brand, topic: 'fees' });

    const res = await app.inject({
      method: 'DELETE',
      url: `/brands/${brand}`,
      headers: AUTH(ownerAToken),
    });
    expect(res.statusCode).toBe(409);

    const aliasesLeft = await db
      .get()
      .select()
      .from(brandAliases)
      .where(eq(brandAliases.brandEntityId, brand));
    const feedsLeft = await db
      .get()
      .select()
      .from(sourceConfigs)
      .where(eq(sourceConfigs.brandEntityId, brand));
    expect(aliasesLeft).toHaveLength(1);
    expect(feedsLeft).toHaveLength(1);
  });

  it('deletes an unused brand together with its aliases and feeds', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/brands/${brand}`,
      headers: AUTH(ownerAToken),
    });
    expect(res.statusCode).toBe(204);
    const left = await db.get().select().from(brandEntities).where(eq(brandEntities.id, brand));
    const feedsLeft = await db
      .get()
      .select()
      .from(sourceConfigs)
      .where(eq(sourceConfigs.brandEntityId, brand));
    expect(left).toHaveLength(0);
    expect(feedsLeft).toHaveLength(0);
  });
});

describe('tenant scoping of the portfolio rollup read', () => {
  it("reads only the 'all' aggregate (no double counting with territory rows)", async () => {
    const [child] = await db
      .get()
      .insert(brandEntities)
      .values({
        tenantId: ids.tenantA,
        name: 'Child',
        slug: `child-${Date.now()}`,
        parentId: ids.brandA,
        kind: 'product',
      })
      .returning();
    await db.get().execute(sql`
      insert into dimension_scores (tenant_id, brand_entity_id, date, dimension, territory, score, signal_count)
      values
        (${ids.tenantA}, ${child!.id}, '2026-08-09', 'trust', 'all', 70, 10),
        (${ids.tenantA}, ${child!.id}, '2026-08-09', 'trust', 'GB', 10, 4)
    `);
    const res = await app.inject({
      method: 'GET',
      url: `/brands/${ids.brandA}/portfolio`,
      headers: AUTH(adminAToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const member = body.members.find((m: { id: string }) => m.id === child!.id);
    expect(member.score).toBe(70);
    // Clean up so later suites see an unchanged tenant.
    await db.get().execute(sql`delete from dimension_scores where brand_entity_id = ${child!.id}`);
    await db
      .get()
      .delete(brandEntities)
      .where(and(eq(brandEntities.id, child!.id), eq(brandEntities.tenantId, ids.tenantA)));
  });
});
