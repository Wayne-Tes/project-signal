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
  id: 'conn-1',
  provider: 'hubspot',
  instanceUrl: null,
  secretArn: 'arn:aws:secretsmanager:eu-west-2:1:secret:psignal-dev-crm/t/hubspot',
  scopes: ['crm.objects.companies.read'],
  connectedBy: 'user-1',
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
  mockWrite.mockResolvedValue('arn:aws:secretsmanager:eu-west-2:1:secret:psignal-dev-crm/t/hubspot');
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
    const res = await app.inject({ method: 'DELETE', url: '/crm/connections/conn-1' });

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
    const res = await app.inject({ method: 'DELETE', url: '/crm/connections/conn-1' });
    expect(res.statusCode).toBe(204);
  });

  it('404s for a connection that is not this tenant’s', async () => {
    _rows = [];
    const app = await buildTestApp(crmRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'DELETE', url: '/crm/connections/someone-else' });
    expect(res.statusCode).toBe(404);
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
