import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_OWNER } from '../helpers/app.js';

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

vi.mock('firebase-admin', () => ({
  default: {
    apps: ['app'],
    initializeApp: vi.fn(),
    auth: vi.fn(() => ({
      setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
      verifyIdToken: vi.fn(),
    })),
  },
}));

import usersRoutes from '../../src/routes/users.js';

const now = new Date();
const user1 = {
  id: 'user-1',
  firebaseUid: 'fb-1',
  tenantId: 'tenant-1',
  role: 'user',
  brandEntityId: 'brand-1',
  createdAt: now,
  updatedAt: now,
};
const ADMIN_T1 = { uid: 'admin-uid', role: 'admin' as const, tenantId: 'tenant-1' };

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('POST /admin/users', () => {
  it('creates a user and sets Firebase custom claims', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: {
        firebaseUid: 'fb-1',
        email: 'user@example.com',
        role: 'user',
        tenantId: 'tenant-1',
        brandEntityId: 'brand-1',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('user-1');
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
      payload: { firebaseUid: 'fb', email: 'x@y.com', role: 'user', tenantId: 'tenant-1' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('forbids an admin from creating a user in another tenant', async () => {
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { firebaseUid: 'fb', email: 'x@y.com', role: 'user', tenantId: 'tenant-2' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids an admin from minting an owner', async () => {
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { firebaseUid: 'fb', email: 'x@y.com', role: 'owner', tenantId: 'tenant-1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets an owner create a user in any tenant', async () => {
    _dbRows = [user1];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { firebaseUid: 'fb', email: 'x@y.com', role: 'owner', tenantId: 'tenant-99' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 403 for a plain user', async () => {
    const app = await buildTestApp(usersRoutes, { uid: 'u', role: 'user', tenantId: 'tenant-1' });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      payload: { firebaseUid: 'fb', email: 'x@y.com', role: 'user', tenantId: 'tenant-1' },
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
      url: '/admin/users/user-1',
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
      url: '/admin/users/nonexistent',
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('forbids an admin from escalating a user to owner', async () => {
    _dbRowQueue.push([user1]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/user-1',
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids an admin from escalating themselves to owner', async () => {
    _dbRowQueue.push([{ ...user1, id: 'self', firebaseUid: 'admin-uid' }]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/self',
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids an admin from modifying an existing owner', async () => {
    _dbRowQueue.push([{ ...user1, role: 'owner' }]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/user-1',
      payload: { role: 'user' },
    });
    expect(res.statusCode).toBe(403);
  });

  // The update ran on `id` alone with no tenant filter, so this crossed tenants entirely.
  it('hides a user in another tenant from an admin', async () => {
    _dbRowQueue.push([{ ...user1, tenantId: 'tenant-2' }]);
    const app = await buildTestApp(usersRoutes, ADMIN_T1);
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/user-1',
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
      url: '/admin/users/user-1',
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
      url: '/admin/users/user-1',
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /admin/users', () => {
  it('returns all users in the tenant', async () => {
    _dbRows = [user1, { ...user1, id: 'user-2', firebaseUid: 'fb-2' }];
    const app = await buildTestApp(usersRoutes, DEFAULT_OWNER);
    const res = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
  });

  it('returns 403 for user role', async () => {
    const app = await buildTestApp(usersRoutes, { uid: 'u', role: 'user', tenantId: 'tenant-1' });
    const res = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(res.statusCode).toBe(403);
  });
});
