import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@project-signal/db';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

const mockWrite = vi.fn();
const mockDelete = vi.fn();
vi.mock('../../src/lib/crm-secrets.js', () => ({
  writeTokens: (...a: unknown[]) => mockWrite(...a),
  deleteTokens: (...a: unknown[]) => mockDelete(...a),
}));

let _rows: unknown[] = [];
const _written: Record<string, unknown>[] = [];

vi.mock('@project-signal/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'insert', 'delete', 'onConflictDoUpdate']) {
    chain[m] = vi.fn(() => chain);
  }
  chain['values'] = vi.fn((v: Record<string, unknown>) => {
    _written.push(v);
    return chain;
  });
  chain['returning'] = vi.fn(() => Promise.resolve(_rows));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(_rows).then(r as never, j as never);
  return { ...actual, db: { get: vi.fn(() => chain) } };
});

import crmRoutes from '../../src/routes/crm.js';

const now = new Date();
const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1111111-1111-4111-8111-111111111111',
  provider: 'hubspot',
  instanceUrl: null,
  secretArn: 'arn:aws:secretsmanager:eu-west-2:1:secret:psignal-dev-crm/t/hubspot',
  scopes: ['crm.objects.companies.read'],
  connectedBy: 'a1111111-1111-4111-8111-111111111111',
  status: 'active',
  lastSyncedAt: null,
  lastAttemptedAt: null,
  lastError: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

const body = {
  provider: 'hubspot',
  accessToken: 'at-secret',
  refreshToken: 'rt-secret',
  expiresAt: Date.now() + 3600_000,
  scopes: ['crm.objects.companies.read'],
};

beforeEach(() => {
  _rows = [];
  _written.length = 0;
  vi.clearAllMocks();
  mockWrite.mockResolvedValue({
    arn: 'arn:aws:secretsmanager:eu-west-2:1:secret:psignal-dev-crm/t/hubspot',
    created: true,
  });
  mockDelete.mockResolvedValue(undefined);
});

describe('POST /crm/connections', () => {
  it('stores the tokens in Secrets Manager, not in Postgres', async () => {
    _rows = [row()];
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/crm/connections', payload: body });

    expect(res.statusCode).toBe(201);
    expect(mockWrite).toHaveBeenCalledOnce();

    /* The row carries an ARN and nothing else. A rotating refresh token in plain JSONB is a
       credential leak waiting for its first incident report. */
    const inserted = JSON.stringify(_written.at(-1));
    expect(inserted).toContain('secretArn');
    expect(inserted).not.toContain('at-secret');
    expect(inserted).not.toContain('rt-secret');
  });

  /* No route may respond with a token. The UI needs the provider, the status and when it last
     worked — nothing more. */
  it('never returns a token', async () => {
    _rows = [row()];
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/crm/connections', payload: body });

    expect(res.body).not.toContain('at-secret');
    expect(res.body).not.toContain('rt-secret');
    expect(res.body).not.toContain('secretArn');
  });

  it('refuses an unknown CRM rather than storing a link nothing can use', async () => {
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/connections',
      payload: { ...body, provider: 'pipedrive' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('hubspot');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  /**
   * Salesforce is per-instance. A missing instance URL would send every request to the wrong org
   * — which looks like it worked, returns data, and attributes another company's records to this
   * tenant. Refused rather than defaulted.
   */
  it('refuses Salesforce without an instance URL', async () => {
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/connections',
      payload: { ...body, provider: 'salesforce' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/instanceUrl/);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('accepts Salesforce with one', async () => {
    _rows = [row({ provider: 'salesforce', instanceUrl: 'https://acme.my.salesforce.com' })];
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/connections',
      payload: { ...body, provider: 'salesforce', instanceUrl: 'https://acme.my.salesforce.com' },
    });
    expect(res.statusCode).toBe(201);
  });

  /* A CRM link reaches a customer's commercial records. That is not a preference a plain user
     sets. */
  it('refuses a plain user', async () => {
    const app = await buildTestApp(crmRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'POST', url: '/crm/connections', payload: body });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /crm/connections/:id', () => {
  it('removes the row and schedules the secret for deletion', async () => {
    _rows = [row()];
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'DELETE',
      url: '/crm/connections/d1111111-1111-4111-8111-111111111111',
    });

    expect(res.statusCode).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith(row().secretArn);
  });

  /**
   * The row is already gone, which is what the user asked for. Reporting failure would tell them
   * the CRM is still linked when it is not — a leftover secret is an operational tidy-up.
   */
  it('still reports success when the secret could not be removed', async () => {
    _rows = [row()];
    mockDelete.mockRejectedValue(new Error('AccessDenied'));
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'DELETE',
      url: '/crm/connections/d1111111-1111-4111-8111-111111111111',
    });
    expect(res.statusCode).toBe(204);
  });

  it('404s for a connection that is not this tenant’s', async () => {
    _rows = [];
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'DELETE',
      url: '/crm/connections/f0000000-0000-4000-8000-00000000f0e1',
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a malformed id at the schema', async () => {
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'DELETE', url: '/crm/connections/someone-else' });
    expect(res.statusCode).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('POST /crm/connections — hardening', () => {
  it.each([
    ['plain http', 'http://acme.my.salesforce.com'],
    ['another scheme', 'file:///etc/passwd'],
    ['not a URL', 'acme.my.salesforce.com'],
  ])('refuses an instance URL that is %s', async (_label, instanceUrl) => {
    /* The future sync sends the tenant's OAuth token to this host. Anything but https would hand
       it to whoever is on the path, or to an internal address. */
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/connections',
      payload: { ...body, provider: 'salesforce', instanceUrl },
    });
    expect(res.statusCode).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('schedules a NEWLY created secret for deletion when the row insert fails', async () => {
    /* Otherwise the secret is an orphan: a live credential no connection references. */
    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { returning: ReturnType<typeof vi.fn> };
    chain.returning.mockRejectedValueOnce(new Error('insert failed'));
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/crm/connections', payload: body });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('insert failed');
    expect(mockDelete).toHaveBeenCalledWith(
      'arn:aws:secretsmanager:eu-west-2:1:secret:psignal-dev-crm/t/hubspot',
    );
  });

  it('leaves an EXISTING secret alone when the insert fails — a connection still uses it', async () => {
    mockWrite.mockResolvedValueOnce({ arn: 'arn:existing', created: false });
    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { returning: ReturnType<typeof vi.fn> };
    chain.returning.mockRejectedValueOnce(new Error('insert failed'));
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/crm/connections', payload: body });

    expect(res.statusCode).toBe(500);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('still fails with the insert error when the cleanup also fails', async () => {
    mockDelete.mockRejectedValueOnce(new Error('cleanup failed'));
    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { returning: ReturnType<typeof vi.fn> };
    chain.returning.mockRejectedValueOnce(new Error('insert failed'));
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/crm/connections', payload: body });
    expect(res.statusCode).toBe(500);
  });

  it('strips undeclared body fields such as a tenant id', async () => {
    _rows = [row()];
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'POST',
      url: '/crm/connections',
      payload: { ...body, tenantId: '22222222-2222-4222-8222-222222222222' },
    });
    expect(res.statusCode).toBe(201);
    expect(_written.at(-1)).toMatchObject({ tenantId: DEFAULT_ADMIN.tenantId });
  });
});

describe('GET /crm/connections', () => {
  it('lists connections without exposing the secret ARN', async () => {
    _rows = [row()];
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/crm/connections' });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('secretArn');
    expect(JSON.parse(res.body)[0].provider).toBe('hubspot');
  });
});
