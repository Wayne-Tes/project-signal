import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

const mockPublish = vi.fn();
vi.mock('@project-signal/messaging', () => ({
  getPublisher: vi.fn(() => ({ publish: mockPublish })),
}));

const setCalls: unknown[] = [];
let rows: unknown[] = [];
const rowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'insert', 'values', 'update', 'delete', 'orderBy', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  chain['set'] = vi.fn((v: unknown) => {
    setCalls.push(v);
    return chain;
  });
  const next = () => (rowQueue.length ? rowQueue.shift()! : rows);
  chain['returning'] = vi.fn(() => Promise.resolve(next()));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(next()).then(r as never, j as never);
  return {
    db: { get: vi.fn(() => chain) },
    scanRuns: { id: 'id', tenantId: 'tenant_id', brandEntityId: 'brand_entity_id', status: 'status', startedAt: 'started_at' },
    brandEntities: {}, tenants: {}, signals: {}, users: {}, sentimentResults: {},
    dimensionScores: {}, sourceConfigs: {}, brandAliases: {}, signalMentions: {},
    conversations: {}, conversationMessages: {}, client: { get: vi.fn() },
  };
});

const { scanRoutes } = await import('../../src/routes/scans.js');

/**
 * On-demand scanning.
 *
 * A scan hits third-party APIs with per-account quotas shared across tenants, and it writes a
 * record the UI depends on to show anything at all. The tests here are about the two ways that
 * goes wrong: spending quota on duplicate runs, and leaving a run in a state the UI waits on
 * forever.
 */

const AUTH = { authorization: 'Bearer t' };
const RUN = { id: 'run-1', brandEntityId: 'b1', status: 'queued', trigger: 'manual' };

beforeEach(() => {
  vi.clearAllMocks();
  setCalls.length = 0;
  rowQueue.length = 0;
  rows = [];
  mockPublish.mockResolvedValue('msg-1');
});

describe('POST /brands/:id/scan', () => {
  it('records a run and queues it', async () => {
    rowQueue.push([], [RUN]);
    const app = await buildTestApp(scanRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/brands/b1/scan', headers: AUTH });

    /* 202, not 200: the work has not happened yet and the response must not imply it has. */
    expect(res.statusCode).toBe(202);
    expect(mockPublish).toHaveBeenCalledWith('scan', expect.stringContaining('run-1'));
  });

  it('refuses a second scan while one is in flight', async () => {
    /* The debounce. A button that hits third-party quotas is a button someone presses eleven
       times, and the quota is shared across every tenant. */
    rowQueue.push([{ id: 'run-0', status: 'running' }]);
    const app = await buildTestApp(scanRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/brands/b1/scan', headers: AUTH });

    expect(res.statusCode).toBe(409);
    expect(mockPublish, 'must not queue a duplicate').not.toHaveBeenCalled();
    /* The existing run comes back so the UI can show its progress rather than an error. */
    expect(JSON.parse(res.body).run.id).toBe('run-0');
  });

  it('marks the run failed when it cannot be queued', async () => {
    /* Otherwise the row sits at `queued` forever: the UI spins, and the debounce keeps refusing
       new scans because one is apparently still in flight. A silent permanent block. */
    rowQueue.push([], [RUN]);
    mockPublish.mockRejectedValueOnce(new Error('sqs unavailable'));
    const app = await buildTestApp(scanRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'POST', url: '/brands/b1/scan', headers: AUTH });

    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(setCalls)).toContain('failed');
    expect(JSON.stringify(setCalls)).toContain('finishedAt');
  });

  it('is refused to a plain user', async () => {
    /* A viewer must not be able to spend the tenant's third-party quota. */
    const app = await buildTestApp(scanRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'POST', url: '/brands/brand-1/scan', headers: AUTH });
    expect(res.statusCode).toBe(403);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('carries the tenant and brand in the queue message, not just the run id', async () => {
    /* The consumer must be able to scope its own queries without trusting a lookup, and must
       never widen from a run id to another tenant's brand. */
    rowQueue.push([], [RUN]);
    const app = await buildTestApp(scanRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'POST', url: '/brands/b1/scan', headers: AUTH });

    const body = JSON.parse(mockPublish.mock.calls[0]![1] as string);
    expect(body).toMatchObject({ scanRunId: 'run-1', tenantId: 'tenant-1', brandEntityId: 'b1' });
  });
});

describe('GET /brands/:id/scans', () => {
  it('returns recent runs, tenant-scoped', async () => {
    rows = [RUN];
    const app = await buildTestApp(scanRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/b1/scans', headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)[0].id).toBe('run-1');
  });
});
