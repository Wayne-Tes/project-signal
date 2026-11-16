import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIngest, mockReconcile, mockRollup } = vi.hoisted(() => ({
  mockIngest: vi.fn(),
  mockReconcile: vi.fn(),
  mockRollup: vi.fn(),
}));

vi.mock('../src/handler.js', () => ({
  handleIngestionJob: mockIngest,
  reconcilePendingSignals: mockReconcile,
}));
vi.mock('../src/rollup.js', () => ({ rollupDimensionScores: mockRollup }));

const { buildApp } = await import('../src/app.js');

beforeEach(() => vi.clearAllMocks());

/**
 * The local-development HTTP surface of the ingestion service.
 *
 * Nothing in AWS reaches it — every scheduled job arrives on the scan queue — but it is how a
 * developer drives one step of the pipeline against the local stack, so it has to work.
 */
describe('ingestion HTTP routes', () => {
  it('reports health and readiness', async () => {
    const app = buildApp({ logger: false });
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({
      status: 'ok',
      service: 'ingestion',
    });
    expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('collects one feed on POST /ingest', async () => {
    mockIngest.mockResolvedValue({ signalsCreated: 2, signalsPublished: 2 });
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/ingest',
      payload: { sourceConfigId: 'cfg-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockIngest).toHaveBeenCalledWith('cfg-1');
    expect(res.json().data).toEqual({ signalsCreated: 2, signalsPublished: 2 });
  });

  it('rejects /ingest without a sourceConfigId', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'POST', url: '/ingest', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it('runs the reconcile sweep and the rollup on demand', async () => {
    mockReconcile.mockResolvedValue({ pending: 1, published: 1 });
    mockRollup.mockResolvedValue({ brands: 1, rows: 4 });
    const app = buildApp({ logger: false });
    expect((await app.inject({ method: 'POST', url: '/reconcile' })).json().data).toEqual({
      pending: 1,
      published: 1,
    });
    expect((await app.inject({ method: 'POST', url: '/rollup' })).json().data).toEqual({
      brands: 1,
      rows: 4,
    });
  });

  it('no longer exposes the all-feeds-at-once dispatch', async () => {
    /* It ran every enabled feed in the database concurrently — the burst against shared
       third-party quotas that the sequential sweep exists to avoid. */
    const app = buildApp({ logger: false });
    expect((await app.inject({ method: 'POST', url: '/ingest/dispatch' })).statusCode).toBe(404);
  });
});
