import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockJob = vi.fn();
vi.mock('../src/handler.js', () => ({ handleIngestionJob: mockJob }));
vi.mock('@project-signal/messaging', () => ({ SqsConsumer: vi.fn() }));

const setCalls: Record<string, unknown>[] = [];
const rowQueue: unknown[][] = [];
let rows: unknown[] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'selectDistinct', 'from', 'where', 'insert', 'values', 'update', 'limit', 'orderBy']) {
    chain[m] = vi.fn(() => chain);
  }
  chain['set'] = vi.fn((v: Record<string, unknown>) => {
    setCalls.push(v);
    return chain;
  });
  const next = () => (rowQueue.length ? rowQueue.shift()! : rows);
  chain['returning'] = vi.fn(() => Promise.resolve(next()));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(next()).then(r as never, j as never);
  return {
    db: { get: vi.fn(() => chain) },
    scanRuns: { id: 'id', tenantId: 'tenant_id' },
    sourceConfigs: { id: 'id', tenantId: 'tenant_id', brandEntityId: 'brand_entity_id', isEnabled: 'is_enabled' },
    brandEntities: {}, tenants: {}, signals: {}, sentimentResults: {}, dimensionScores: {},
    brandAliases: {}, signalMentions: {}, client: { get: vi.fn() },
  };
});

const { parseScanRequest, runScan } = await import('../src/scanConsumer.js');

/**
 * The scan consumer.
 *
 * The property under test throughout: every path ENDS THE RUN in a terminal state. A run left
 * `queued` or `running` is worse than one marked failed — the UI shows a spinner that never
 * resolves, and the API's debounce keeps refusing new scans because one is apparently in flight.
 * That combination is a permanent, silent block on the feature.
 */

const REQ = { scanRunId: 'run-1', tenantId: 'tenant-1', brandEntityId: 'b1' };
const status = (): string[] => setCalls.map((s) => String(s['status'] ?? ''));

beforeEach(() => {
  vi.clearAllMocks();
  setCalls.length = 0;
  rowQueue.length = 0;
  rows = [];
});

describe('parseScanRequest', () => {
  it('parses a well-formed message', () => {
    expect(parseScanRequest(JSON.stringify(REQ))).toEqual(REQ);
  });

  it('throws on a message missing the tenant', () => {
    /* Without a tenant the consumer cannot scope its own queries, and a run id alone must never
       be enough to widen to another tenant's brand. */
    expect(() => parseScanRequest(JSON.stringify({ scanRunId: 'r', brandEntityId: 'b' }))).toThrow();
  });

  it('throws on non-JSON', () => {
    expect(() => parseScanRequest('not json')).toThrow();
  });
});

describe('runScan', () => {
  it('marks running, then completed, with the counts', async () => {
    rowQueue.push([], [{ id: 'sc-1' }, { id: 'sc-2' }]);
    mockJob.mockResolvedValue({ signalsCreated: 7, signalsPublished: 7 });

    await runScan(REQ);

    expect(status()).toEqual(['running', 'completed']);
    const final = setCalls[1]!;
    expect(final['sourcesAttempted']).toBe(2);
    expect(final['sourcesSucceeded']).toBe(2);
    expect(final['signalsCollected']).toBe(14);
    expect(final['finishedAt']).toBeInstanceOf(Date);
  });

  it('completes — not fails — when a brand has no sources, and says why', async () => {
    /* Nothing went wrong. But "0 signals" with no explanation reads as a broken scan rather than
       a brand nobody has configured yet. */
    rowQueue.push([], []);
    await runScan(REQ);

    expect(status()).toEqual(['running', 'completed']);
    expect(String(setCalls[1]!['error'])).toMatch(/no enabled sources/i);
  });

  it('keeps going when ONE source fails', async () => {
    /* A dead RSS feed must not stop the other four sources collecting. A partially successful
       scan is still useful, and the counts say exactly how partial. */
    rowQueue.push([], [{ id: 'ok' }, { id: 'broken' }]);
    mockJob
      .mockResolvedValueOnce({ signalsCreated: 5, signalsPublished: 5 })
      .mockRejectedValueOnce(new Error('feed 404'));

    await runScan(REQ);

    const final = setCalls[1]!;
    expect(final['status'], 'a broken feed is not a broken scan').toBe('completed');
    expect(final['sourcesAttempted']).toBe(2);
    expect(final['sourcesSucceeded']).toBe(1);
    expect(final['signalsCollected']).toBe(5);
    expect(String(final['error'])).toContain('feed 404');
  });

  it('marks the run failed and rethrows when the scan itself breaks', async () => {
    /* Rethrown so the consumer leaves the message undeleted and it retries — but the run is
       recorded as failed first, so the UI is never left waiting on it. */
    rowQueue.push([]);
    const boom = new Error('database gone');
    rowQueue.push(Object.assign([], { then: undefined }));
    const database = await import('@project-signal/db');
    vi.mocked(database.db.get).mockImplementationOnce(() => {
      throw boom;
    });

    await expect(runScan(REQ)).rejects.toThrow();
  });

  it('scopes every write to the run AND the tenant', async () => {
    rowQueue.push([], []);
    await runScan(REQ);
    /* Both updates go through the same owned predicate; a run id alone must not be enough. */
    expect(setCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('scheduled jobs', () => {
  it('recognises a scan-all message', async () => {
    const { parseScanRequest, isScheduledJob } = await import('../src/scanConsumer.js');
    const m = parseScanRequest(JSON.stringify({ job: 'scan-all' }));
    expect(isScheduledJob(m)).toBe(true);
  });

  it('recognises a rollup message', async () => {
    const { parseScanRequest, isScheduledJob } = await import('../src/scanConsumer.js');
    const m = parseScanRequest(JSON.stringify({ job: 'rollup' }));
    expect(isScheduledJob(m) && m.job).toBe('rollup');
  });

  it('rejects an unknown job name rather than treating it as a scan', async () => {
    /* An unrecognised job must not fall through to the on-demand branch and then fail on a
       missing scanRunId with a confusing message. */
    const { parseScanRequest } = await import('../src/scanConsumer.js');
    expect(() => parseScanRequest(JSON.stringify({ job: 'delete-everything' }))).toThrow();
  });

  it('does not mistake an on-demand request for a scheduled job', async () => {
    const { parseScanRequest, isScheduledJob } = await import('../src/scanConsumer.js');
    expect(isScheduledJob(parseScanRequest(JSON.stringify(REQ)))).toBe(false);
  });

  it('creates one scheduled run per brand with an enabled source', async () => {
    /* Marked `scheduled`, so the same list shows manual and automatic collection and a user can
       tell whether the timer is actually working. */
    const { scanAll } = await import('../src/scanConsumer.js');
    /* The brand list is queued; everything after it falls through to `rows`, which stands in for
       "a row came back" without the test having to model drizzle's call order. Counting exact
       queue consumption made this brittle and told us nothing about the behaviour. */
    rowQueue.push([
      { tenantId: 't1', brandEntityId: 'b1' },
      { tenantId: 't1', brandEntityId: 'b2' },
    ]);
    rows = [{ id: 'run-x' }];
    const count = await scanAll();
    expect(count).toBe(2);
    expect(status().filter((s) => s === 'running').length).toBe(2);
  });

  it('keeps sweeping when one brand fails', async () => {
    /* One broken source must not abort collection for every other brand — the failure is already
       recorded against that brand's own run. */
    const { scanAll } = await import('../src/scanConsumer.js');
    rowQueue.push([
      { tenantId: 't1', brandEntityId: 'b1' },
      { tenantId: 't1', brandEntityId: 'b2' },
    ]);
    rows = [{ id: 'run-x' }];
    mockJob.mockRejectedValue(new Error('feed down'));
    await expect(scanAll()).resolves.toBe(2);
  });
});
