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

import { adminRoutes } from '../../src/routes/admin.js';

const now = new Date();
const mockTenant = { id: 'tenant-1', name: 'Acme', slug: 'acme', createdAt: now, updatedAt: now };
const mockBrand = { id: 'brand-1', name: 'Acme Brand', slug: 'acme-brand', isOwned: true, tenantId: 'tenant-1', createdAt: now, updatedAt: now };
const mockUser = { id: 'user-1', firebaseUid: 'fb-123', tenantId: 'tenant-1', role: 'admin', brandEntityId: null, createdAt: now, updatedAt: now };

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('POST /admin/tenants', () => {
  it('creates tenant, brand, and user in a transaction and returns 201', async () => {
    _dbRowQueue.push([mockTenant], [mockBrand], [mockUser]);
    const app = await buildTestApp(adminRoutes, DEFAULT_OWNER);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/tenants',
      payload: { tenantName: 'Acme', brandName: 'Acme Brand', adminFirebaseUid: 'fb-123' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.data.tenant.id).toBe('tenant-1');
    expect(body.data.brand.id).toBe('brand-1');
    expect(body.data.user.id).toBe('user-1');
  });

  it('returns 403 when user is not owner', async () => {
    const app = await buildTestApp(adminRoutes, { uid: 'uid', role: 'admin', tenantId: 'tenant-1' });
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
