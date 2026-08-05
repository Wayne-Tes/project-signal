import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_OWNER } from '../helpers/app.js';

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
const user1 = { id: 'user-1', firebaseUid: 'fb-1', tenantId: 'tenant-1', role: 'user', brandEntityId: 'brand-1', createdAt: now, updatedAt: now };

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

  it('returns 403 for admin role (requires owner)', async () => {
    const app = await buildTestApp(usersRoutes, { uid: 'u', role: 'admin', tenantId: 'tenant-1' });
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
