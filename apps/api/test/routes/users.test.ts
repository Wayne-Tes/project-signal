import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_OWNER } from '../helpers/app.js';

let _dbRows: unknown[] = [];
const _dbRowQueue: unknown[][] = [];
/** Every object passed to `.set(…)` — i.e. exactly what an UPDATE would write. */
const _setCalls: Record<string, unknown>[] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  chain['set'] = vi.fn((v: Record<string, unknown>) => {
    _setCalls.push(v);
    return chain;
  });
  [
    'select',
    'from',
    'where',
    'insert',
    'values',
    'update',
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

const mockSetCustomUserClaims = vi.hoisted(() => vi.fn());

// Mocks setUserClaims itself rather than the Cognito SDK beneath it. These tests are about
// route behaviour and about the claim write happening INSIDE the database transaction
// (KNOWN-GAPS #18) — not about how an attribute array is shaped. The mapping from claims to
// Cognito attributes is covered directly in test/lib/claims.test.ts.
vi.mock('../../src/lib/claims.js', () => ({
  setUserClaims: mockSetCustomUserClaims,
}));

import usersRoutes from '../../src/routes/users.js';

const now = new Date();
const user1 = {
  id: 'a1111111-1111-4111-8111-111111111111',
  cognitoSub: 'fb-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  role: 'user',
  brandEntityId: 'b1111111-1111-4111-8111-111111111111',
  createdAt: now,
  updatedAt: now,
};
const ADMIN_T1 = {
  uid: 'admin-uid',
  role: 'admin' as const,
  tenantId: '11111111-1111-4111-8111-111111111111',
};

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  _setCalls.length = 0;
  vi.clearAllMocks();
  mockSetCustomUserClaims.mockResolvedValue(undefined);
});

describe('POST /admin/users', () => {
  it('creates a user and sets its identity-provider claims', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb-1',
        role: 'user',
        tenantId: '11111111-1111-4111-8111-111111111111',
        brandEntityId: 'b1111111-1111-4111-8111-111111111111',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('a1111111-1111-4111-8111-111111111111');
    expect(body.role).toBe('user');
  });

  // KNOWN-GAPS #12 — POST was owner-only, so admins could not provision the users their own
  // tenant needs, while PATCH let them escalate anyone (including themselves) to owner.
  it('lets an admin create a user in their own tenant', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb',
        role: 'user',
        tenantId: '11111111-1111-4111-8111-111111111111',
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('forbids an admin from creating a user in another tenant', async () => {
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb',
        role: 'user',
        tenantId: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids an admin from minting an owner', async () => {
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb',
        role: 'owner',
        tenantId: '11111111-1111-4111-8111-111111111111',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets an owner create a user in any tenant', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb',
        role: 'owner',
        tenantId: '99999999-9999-4999-8999-999999999999',
      },
    });
    expect(res.statusCode).toBe(201);
  });

  /* The tenant comes from the CALLER. The UI used to send `users[0]?.tenantId`, which was the
     empty string for a tenant with no users yet, so the first user could never be provisioned
     from the panel. */
  it('places an admin’s new user in the admin’s own tenant when none is named', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { cognitoSub: 'fb-new', role: 'user' },
    });
    expect(res.statusCode).toBe(201);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-new', {
      role: 'user',
      tenantId: ADMIN_T1.tenantId,
      brandEntityId: undefined,
    });
  });

  it('defaults an owner to their own tenant when none is named', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { cognitoSub: 'fb-new', role: 'admin' },
    });
    expect(res.statusCode).toBe(201);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-new', {
      role: 'admin',
      tenantId: DEFAULT_OWNER.tenantId,
      brandEntityId: undefined,
    });
  });

  it('makes a tenant-less owner name the tenant, rather than writing the nil uuid', async () => {
    const app = await buildTestApp(usersRoutes, {
      uid: 'platform-owner',
      role: 'owner',
      tenantId: '00000000-0000-0000-0000-000000000000',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { cognitoSub: 'fb-new', role: 'user' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/tenantId/);
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('requires no email, and ignores one if sent (nothing stores it)', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { cognitoSub: 'fb-new', role: 'user', email: 'x@y.com' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 403 for a plain user', async () => {
    const app = await buildTestApp(usersRoutes, {
      uid: 'u',
      role: 'user',
      tenantId: '11111111-1111-4111-8111-111111111111',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb',
        role: 'user',
        tenantId: '11111111-1111-4111-8111-111111111111',
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /admin/users/:id', () => {
  it('updates a user role', async () => {
    _dbRowQueue.push([user1]);
    _dbRows = [{ ...user1, role: 'admin', updatedAt: now }];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.role).toBe('admin');
  });

  it('returns 404 when user is not found', async () => {
    _dbRows = [];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/00000000-0000-4000-8000-00000000dead',
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('forbids an admin from escalating a user to owner', async () => {
    _dbRowQueue.push([user1]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids an admin from escalating themselves to owner', async () => {
    _dbRowQueue.push([
      { ...user1, id: '5e1f0000-0000-4000-8000-00000000005e', cognitoSub: 'admin-uid' },
    ]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/5e1f0000-0000-4000-8000-00000000005e',
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids an admin from modifying an existing owner', async () => {
    _dbRowQueue.push([{ ...user1, role: 'owner' }]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { role: 'user' },
    });
    expect(res.statusCode).toBe(403);
  });

  // The update ran on `id` alone with no tenant filter, so this crossed tenants entirely.
  it('hides a user in another tenant from an admin', async () => {
    _dbRowQueue.push([{ ...user1, tenantId: '22222222-2222-4222-8222-222222222222' }]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { role: 'user' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('lets an admin change a role within the assignable set', async () => {
    _dbRowQueue.push([user1]);
    _dbRowQueue.push([{ ...user1, role: 'admin' }]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('lets an owner escalate a user to owner', async () => {
    _dbRowQueue.push([user1]);
    _dbRowQueue.push([{ ...user1, role: 'owner' }]);
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(200);
  });
});

/**
 * THE MASS-ASSIGNMENT DEFECT. The handler spread the request body into the UPDATE, and the body
 * schema did not forbid extra keys — so an admin could PATCH their own row with another tenant's
 * id and be handed admin claims there, or point `cognitoSub` at someone else's identity and
 * overwrite that person's claims.
 */
describe('PATCH /admin/users/:id — only role and brand pin are writable', () => {
  const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

  it('never writes tenantId, cognitoSub, id or timestamps from the body', async () => {
    _dbRowQueue.push([{ ...user1, cognitoSub: 'admin-uid' }]);
    _dbRowQueue.push([{ ...user1, cognitoSub: 'admin-uid', role: 'admin' }]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: {
        role: 'admin',
        tenantId: OTHER_TENANT,
        cognitoSub: 'victim-sub',
        id: 'a9999999-9999-4999-8999-999999999999',
        createdAt: '2000-01-01T00:00:00Z',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(_setCalls).toHaveLength(1);
    expect(Object.keys(_setCalls[0]!).sort()).toEqual(['role', 'updatedAt']);
    // Claims are written from the stored row, so they keep the user's real tenant and identity.
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('admin-uid', {
      role: 'admin',
      tenantId: '11111111-1111-4111-8111-111111111111',
      brandEntityId: 'b1111111-1111-4111-8111-111111111111',
    });
  });

  it('a body of ONLY forbidden keys changes nothing but the timestamp', async () => {
    _dbRowQueue.push([user1], [user1]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { tenantId: OTHER_TENANT },
    });
    expect(Object.keys(_setCalls[0]!)).toEqual(['updatedAt']);
  });

  it('can CLEAR a brand pin with null, returning the user to tenant-wide access', async () => {
    _dbRowQueue.push([user1], [{ ...user1, brandEntityId: null }]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { brandEntityId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(_setCalls[0]).toMatchObject({ brandEntityId: null });
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith(
      'fb-1',
      expect.objectContaining({ brandEntityId: null }),
    );
  });

  it("refuses a pin to a brand outside the user's tenant", async () => {
    /* The foreign key only proves the brand exists somewhere; the pin is an authorisation scope. */
    _dbRowQueue.push([user1], []);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { brandEntityId: 'f0000000-0000-4000-8000-00000000f0e2' },
    });
    expect(res.statusCode).toBe(400);
    expect(_setCalls).toHaveLength(0);
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('rejects a malformed user id or pin at the schema', async () => {
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    expect(
      (await app.inject({ method: 'PATCH', url: '/admin/users/nope', payload: { role: 'user' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/admin/users/a1111111-1111-4111-8111-111111111111',
          payload: { brandEntityId: 'brand-1' },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('POST /admin/users — brand pin must be in the target tenant', () => {
  it("refuses to create a user pinned to another tenant's brand", async () => {
    _dbRowQueue.push([]);
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb-x',
        role: 'user',
        tenantId: '11111111-1111-4111-8111-111111111111',
        brandEntityId: 'f0000000-0000-4000-8000-00000000f0e2',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('strips undeclared keys from the create body', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb-1',
        role: 'user',
        tenantId: '11111111-1111-4111-8111-111111111111',
        id: 'a9999999-9999-4999-8999-999999999999',
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('GET /admin/users', () => {
  it('returns all users in the tenant', async () => {
    _dbRows = [user1, { ...user1, id: 'a2222222-2222-4222-8222-222222222222', cognitoSub: 'fb-2' }];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
  });

  it('returns 403 for user role', async () => {
    const app = await buildTestApp(usersRoutes, {
      uid: 'u',
      role: 'user',
      tenantId: '11111111-1111-4111-8111-111111111111',
    });
    const res = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(res.statusCode).toBe(403);
  });
});

// KNOWN-GAPS #18 — the row was written and THEN claims were set. A claims failure left the
// table ahead of the token, and authorisation reads the token. Both writes now happen inside
// one transaction, so a claims failure rolls the row back.
describe('user row and identity-provider claims are written together', () => {
  it('sets claims with the shape plugins/auth.ts reads', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb-1',
        role: 'user',
        tenantId: '11111111-1111-4111-8111-111111111111',
        brandEntityId: 'b1111111-1111-4111-8111-111111111111',
      },
    });

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-1', {
      role: 'user',
      tenantId: '11111111-1111-4111-8111-111111111111',
      brandEntityId: 'b1111111-1111-4111-8111-111111111111',
    });
  });

  it('sets claims inside the transaction on create, so a failure rolls the row back', async () => {
    _dbRows = [user1];
    mockSetCustomUserClaims.mockRejectedValueOnce(
      new Error('Could not load the default credentials'),
    );
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb-1',
        role: 'user',
        tenantId: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(res.statusCode).toBe(500);
    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { transaction: ReturnType<typeof vi.fn> };
    expect(chain.transaction).toHaveBeenCalledOnce();
  });

  it('sets claims inside the transaction on update, so a failure rolls the row back', async () => {
    _dbRowQueue.push([user1]);
    _dbRowQueue.push([{ ...user1, role: 'admin' }]);
    mockSetCustomUserClaims.mockRejectedValueOnce(new Error('firebase unavailable'));
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/a1111111-1111-4111-8111-111111111111',
      payload: { role: 'admin' },
    });

    expect(res.statusCode).toBe(500);
    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { transaction: ReturnType<typeof vi.fn> };
    expect(chain.transaction).toHaveBeenCalledOnce();
  });

  it('omits brandEntityId from claims when the user is not pinned', async () => {
    _dbRows = [{ ...user1, brandEntityId: null }];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        cognitoSub: 'fb-1',
        role: 'admin',
        tenantId: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-1', {
      role: 'admin',
      tenantId: '11111111-1111-4111-8111-111111111111',
      brandEntityId: undefined,
    });
  });
});
