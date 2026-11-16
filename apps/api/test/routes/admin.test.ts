import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_OWNER } from '../helpers/app.js';

const mockSetCustomUserClaims = vi.hoisted(() => vi.fn());

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

// See the note in test/routes/users.test.ts: mocking setUserClaims keeps these tests focused on
// the transactional guarantee rather than on Cognito's wire format.
vi.mock('../../src/lib/claims.js', () => ({
  setUserClaims: mockSetCustomUserClaims,
}));

import { adminRoutes } from '../../src/routes/admin.js';

const now = new Date();
const mockTenant = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme',
  slug: 'acme',
  createdAt: now,
  updatedAt: now,
};
const mockBrand = {
  id: 'b1111111-1111-4111-8111-111111111111',
  name: 'Acme Brand',
  slug: 'acme-brand',
  isOwned: true,
  tenantId: '11111111-1111-4111-8111-111111111111',
  createdAt: now,
  updatedAt: now,
};
const mockUser = {
  id: 'a1111111-1111-4111-8111-111111111111',
  firebaseUid: 'fb-123',
  tenantId: '11111111-1111-4111-8111-111111111111',
  role: 'admin',
  brandEntityId: null,
  createdAt: now,
  updatedAt: now,
};

/** The slug pre-check finding no existing tenant. */
const NO_SLUG_CLASH: unknown[] = [];

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
  mockSetCustomUserClaims.mockResolvedValue(undefined);
});

describe('POST /admin/tenants', () => {
  it('creates tenant, brand, and user in a transaction and returns 201', async () => {
    _dbRowQueue.push(NO_SLUG_CLASH, [mockTenant], [mockBrand], [mockUser]);
    const app = await buildTestApp(adminRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      payload: { tenantName: 'Acme', brandName: 'Acme Brand', adminFirebaseUid: 'fb-123' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.data.tenant.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.data.brand.id).toBe('b1111111-1111-4111-8111-111111111111');
    expect(body.data.user.id).toBe('a1111111-1111-4111-8111-111111111111');
  });

  it('returns 403 when user is not owner', async () => {
    const app = await buildTestApp(adminRoutes, {
      uid: 'uid',
      role: 'admin',
      tenantId: '11111111-1111-4111-8111-111111111111',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      payload: { tenantName: 'X', brandName: 'Y', adminFirebaseUid: 'z' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('toSlug (via tenant name)', () => {
  it('converts tenant name to a lowercase slug', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    _dbRowQueue.push(NO_SLUG_CLASH);
    chain.returning
      .mockResolvedValueOnce([{ ...mockTenant, slug: 'acme-corp' }])
      .mockResolvedValueOnce([mockBrand])
      .mockResolvedValueOnce([mockUser]);

    const app = await buildTestApp(adminRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      payload: { tenantName: 'Acme Corp', brandName: 'Brand', adminFirebaseUid: 'fb' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.tenant.slug).toBe('acme-corp');
  });
});

// KNOWN-GAPS #18 — tenant creation wrote the admin's `users` row but never set claims, and
// authorisation reads claims. The freshly provisioned admin could not authorise any request,
// which made this onboarding path produce a tenant nobody could administer.
describe('tenant provisioning sets the admin custom claims', () => {
  it('grants the new admin role and tenantId', async () => {
    _dbRowQueue.push(NO_SLUG_CLASH, [mockTenant], [mockBrand], [mockUser]);
    const app = await buildTestApp(adminRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      payload: { tenantName: 'Acme', brandName: 'Acme Brand', adminFirebaseUid: 'fb-123' },
    });

    expect(res.statusCode).toBe(201);
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-123', {
      role: 'admin',
      tenantId: '11111111-1111-4111-8111-111111111111',
      brandEntityId: undefined,
    });
  });

  it('rolls the tenant back when the claims call fails', async () => {
    _dbRowQueue.push(NO_SLUG_CLASH, [mockTenant], [mockBrand], [mockUser]);
    mockSetCustomUserClaims.mockRejectedValueOnce(new Error('firebase unavailable'));
    const app = await buildTestApp(adminRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      payload: { tenantName: 'Acme', brandName: 'Acme Brand', adminFirebaseUid: 'fb-123' },
    });

    // A tenant whose only admin cannot sign in is worse than no tenant at all.
    expect(res.statusCode).toBe(500);
    // And the cause stays in the log: the 500 body never carries an error's own message.
    expect(res.body).not.toContain('firebase unavailable');
  });
});

describe('POST /admin/tenants — guards', () => {
  it('refuses an owner naming themselves as the new admin, which would demote them', async () => {
    /* The claims call writes role=admin for adminFirebaseUid. Pointed at the calling owner, it
       silently replaced the only identity able to create tenants with an admin of one tenant. */
    const app = await buildTestApp(adminRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      payload: { tenantName: 'Acme', brandName: 'B', adminFirebaseUid: DEFAULT_OWNER.uid },
    });
    expect(res.statusCode).toBe(400);
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('answers a slug collision with a clear 409 instead of a unique-violation', async () => {
    _dbRowQueue.push([{ id: mockTenant.id }]);
    const app = await buildTestApp(adminRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      payload: { tenantName: 'Acme!', brandName: 'B', adminFirebaseUid: 'fb-9' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toContain("'acme'");
    expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
  });

  it('rejects an empty tenant name', async () => {
    const app = await buildTestApp(adminRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      payload: { tenantName: '', brandName: 'B', adminFirebaseUid: 'fb-9' },
    });
    expect(res.statusCode).toBe(400);
  });
});
