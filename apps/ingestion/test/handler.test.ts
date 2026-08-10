import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPublish, mockFetch, mockToSignal, mockPut } = vi.hoisted(() => ({
  mockPublish: vi.fn().mockResolvedValue('msg-id'),
  mockFetch: vi.fn(),
  mockToSignal: vi.fn(),
  mockPut: vi.fn(),
}));

/** A mocked table whose every column is a traceable sentinel. */
function table(name: string) {
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => ({ __table: name, __col: String(prop) }),
  });
}

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  let _rows: unknown[] = [];
  const queue: unknown[][] = [];
  ['select', 'from', 'insert', 'values', 'update', 'set', 'leftJoin', 'limit'].forEach(
    (m) => {
      chain[m] = vi.fn(() => chain);
    },
  );
  /* `where` is recorded rather than merely stubbed. A mock database ignores predicates, so a
     test that only checks the value coming back cannot tell "the watermark for THIS feed" from
     "the watermark for this brand and source type" — which is exactly the defect being fixed
     here, and exactly what a first version of these tests failed to catch. Capturing the
     predicate makes the column being filtered on assertable. */
  const wheres: unknown[] = [];
  chain['where'] = vi.fn((predicate: unknown) => {
    wheres.push(predicate);
    return chain;
  });
  (chain as any)._wheres = wheres;
  const nextRows = () => (queue.length ? queue.shift()! : _rows);
  chain['onConflictDoNothing'] = vi.fn(() => chain);
  chain['returning'] = vi.fn(() => Promise.resolve(nextRows()));
  chain['then'] = (r: unknown, j?: unknown) =>
    Promise.resolve(nextRows()).then(r as never, j as never);
  (chain as any)._setRows = (rows: unknown[]) => {
    _rows = rows;
  };
  (chain as any)._queue = queue;
  return {
    db: { get: vi.fn(() => chain) },
    /* Columns are sentinels, so a captured predicate can be traced back to the column it was
       built from. `{}` would make every column `undefined` and indistinguishable. */
    brandEntities: table('brand_entities'),
    signals: table('signals'),
    sentimentResults: table('sentiment_results'),
    sourceConfigs: table('source_configs'),
    client: { get: vi.fn() },
  };
});

vi.mock('@project-signal/messaging', () => ({
  getPublisher: vi.fn(() => ({ publish: mockPublish })),
  queueUrl: vi.fn(() => 'https://sqs.eu-west-2.amazonaws.com/1/psignal-dev-item'),
}));

vi.mock('@project-signal/storage', () => ({
  getObjectStore: vi.fn(() => ({ put: mockPut, get: vi.fn() })),
  rawKey: (t: string, b: string, s: string, e: string) => `${t}/${b}/${s}/${e}.json`,
}));

vi.mock('@project-signal/config', () => ({
  getEnv: vi.fn(() => ({
    APIFY_API_KEY: 'apify-key',
    YOUTUBE_API_KEY: 'yt-key',
  })),
}));

vi.mock('@project-signal/source-adapters', () => {
  class MockAdapter {
    fetch = mockFetch;
    toSignal = mockToSignal;
  }
  return {
    GoogleReviewsAdapter: MockAdapter,
    AppStoreAdapter: MockAdapter,
    PlayStoreAdapter: MockAdapter,
    RedditAdapter: MockAdapter,
    RssAdapter: MockAdapter,
    YoutubeAdapter: MockAdapter,
  };
});

import { handleIngestionJob, reconcilePendingSignals } from '../src/handler.js';

const now = new Date();
const cfg = {
  id: 'cfg-1',
  tenantId: 'tenant-1',
  brandEntityId: 'brand-1',
  source: 'google_reviews',
  isEnabled: true,
  config: { placeId: 'abc' },
  lastFetchedAt: null,
  createdAt: now,
  updatedAt: now,
};
const brand = {
  id: 'brand-1',
  tenantId: 'tenant-1',
  name: 'Acme',
  slug: 'acme',
  isOwned: true,
  createdAt: now,
  updatedAt: now,
};

beforeEach(async () => {
  vi.clearAllMocks();
  mockPut.mockResolvedValue('s3://raw/t/b/s/x.json');
  mockPublish.mockResolvedValue('msg-id');
  const { db } = await import('@project-signal/db');
  const chain = db.get() as any;
  chain._setRows([]);
  chain._queue.length = 0;
});

describe('handleIngestionJob', () => {
  it('fetches, inserts signals, and publishes to the item queue', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValueOnce([{ id: 'signal-new-1' }]);
    chain.returning.mockResolvedValue([]);

    mockFetch.mockResolvedValue({ items: [{ url: 'https://example.com/r/1', publishedAt: now }] });
    mockToSignal.mockReturnValue({
      brandEntityId: 'brand-1',
      tenantId: 'tenant-1',
      source: 'google_reviews',
    });

    const result = await handleIngestionJob('cfg-1');

    expect(result.signalsCreated).toBe(1);
    expect(result.signalsPublished).toBe(1);
    expect(mockPublish).toHaveBeenCalledWith('item', 'signal-new-1');
  });

  // KNOWN-GAPS #7 — the handler used to name the concrete topic itself, and published to a
  // hardcoded constant that existed in no deployed environment. It now names only the logical
  // queue; resolving that to a concrete URL is the publisher's job, and the failure mode of an
  // unset URL is covered in libs/messaging rather than duplicated here.
  it('publishes by logical queue name, leaving URL resolution to the publisher', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValueOnce([{ id: 'signal-new-1' }]);
    chain.returning.mockResolvedValue([]);

    mockFetch.mockResolvedValue({ items: [{ url: 'https://example.com/r/1', publishedAt: now }] });
    mockToSignal.mockReturnValue({
      brandEntityId: 'brand-1',
      tenantId: 'tenant-1',
      source: 'google_reviews',
    });

    await handleIngestionJob('cfg-1');

    expect(mockPublish).toHaveBeenCalledWith('item', 'signal-new-1');
    expect(mockPublish.mock.calls.every(([queue]) => queue === 'item')).toBe(true);
  });

  // KNOWN-GAPS #4 — rawStorageRef held item.url and the fetched text was discarded, so the
  // audit trail was empty and scoring had nothing real to read.
  it('stores the raw payload and persists the returned reference, not the source URL', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValueOnce([{ id: 'signal-new-1' }]);
    chain.returning.mockResolvedValue([]);

    mockPut.mockResolvedValue('s3://raw/tenant-1/brand-1/google_reviews/ext-1.json');
    mockFetch.mockResolvedValue({
      items: [
        {
          externalId: 'ext-1',
          url: 'https://example.com/r/1',
          text: 'The app keeps crashing.',
          publishedAt: now,
          metadata: { rating: 1 },
        },
      ],
    });
    mockToSignal.mockReturnValue({
      brandEntityId: 'brand-1',
      tenantId: 'tenant-1',
      source: 'google_reviews',
    });

    await handleIngestionJob('cfg-1');

    expect(mockPut).toHaveBeenCalledOnce();
    const [key, body] = mockPut.mock.calls[0]!;
    expect(key).toBe('tenant-1/brand-1/google_reviews/ext-1.json');
    expect(JSON.parse(body as string)).toMatchObject({
      externalId: 'ext-1',
      url: 'https://example.com/r/1',
      text: 'The app keeps crashing.',
      metadata: { rating: 1 },
    });

    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        rawStorageRef: 's3://raw/tenant-1/brand-1/google_reviews/ext-1.json',
      }),
    );
  });

  it('does not insert a signal row when the raw upload fails', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);

    mockPut.mockRejectedValue(new Error('bucket unavailable'));
    mockFetch.mockResolvedValue({
      items: [
        { externalId: 'ext-1', url: 'https://e.com/1', text: 'x', publishedAt: now, metadata: {} },
      ],
    });
    mockToSignal.mockReturnValue({
      brandEntityId: 'brand-1',
      tenantId: 'tenant-1',
      source: 'google_reviews',
    });

    await expect(handleIngestionJob('cfg-1')).rejects.toThrow('bucket unavailable');
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it('throws when source config is not found', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([]);

    await expect(handleIngestionJob('cfg-missing')).rejects.toThrow('source_config not found');
  });

  it('throws when brand entity is not found', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], []);

    await expect(handleIngestionJob('cfg-1')).rejects.toThrow('brand_entity not found');
  });

  it('returns zero counts when adapter returns no items', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    mockFetch.mockResolvedValue({ items: [] });

    const result = await handleIngestionJob('cfg-1');
    expect(result.signalsCreated).toBe(0);
    expect(result.signalsPublished).toBe(0);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('skips duplicate signals (onConflictDoNothing returns empty)', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValue([]);

    mockFetch.mockResolvedValue({ items: [{ url: 'https://dup.com', publishedAt: now }] });
    mockToSignal.mockReturnValue({
      brandEntityId: 'brand-1',
      tenantId: 'tenant-1',
      source: 'google_reviews',
    });

    const result = await handleIngestionJob('cfg-1');
    expect(result.signalsCreated).toBe(0);
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe('getSystemCredentials (via handler behaviour)', () => {
  it('passes apifyApiKey for google_reviews source', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    mockFetch.mockResolvedValue({ items: [] });

    await handleIngestionJob('cfg-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ apifyApiKey: 'apify-key' }),
      }),
      undefined,
    );
  });

  it('passes youtubeApiKey for youtube source', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    const ytCfg = { ...cfg, source: 'youtube' };
    chain._queue.push([ytCfg], [brand], [{ latest: null }]);
    mockFetch.mockResolvedValue({ items: [] });

    await handleIngestionJob('cfg-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ youtubeApiKey: 'yt-key' }),
      }),
      undefined,
    );
  });

  it('passes apifyApiKey for app_store source', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([{ ...cfg, source: 'app_store' }], [brand], [{ latest: null }]);
    mockFetch.mockResolvedValue({ items: [] });

    await handleIngestionJob('cfg-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ apifyApiKey: 'apify-key' }),
      }),
      undefined,
    );
  });

  it('passes apifyApiKey for play_store source', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([{ ...cfg, source: 'play_store' }], [brand], [{ latest: null }]);
    mockFetch.mockResolvedValue({ items: [] });

    await handleIngestionJob('cfg-1');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({ apifyApiKey: 'apify-key' }),
      }),
      undefined,
    );
  });

  it('passes no system credentials for rss source (default branch)', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push(
      [{ ...cfg, source: 'rss', config: { feedUrl: 'https://x/feed' } }],
      [brand],
      [{ latest: null }],
    );
    mockFetch.mockResolvedValue({ items: [] });

    await handleIngestionJob('cfg-1');

    const callArgs = mockFetch.mock.calls[0]?.[0] as { credentials: Record<string, string> };
    expect(callArgs.credentials.apifyApiKey).toBeUndefined();
    expect(callArgs.credentials.youtubeApiKey).toBeUndefined();
    expect(callArgs.credentials.feedUrl).toBe('https://x/feed');
  });
});

// KNOWN-GAPS #2 — Cloud Scheduler POSTed /reconcile hourly and got a 404 because the
// endpoint did not exist, so signals lost to a failed dual-write were never recovered.
describe('reconcilePendingSignals', () => {
  it('re-publishes signals that have no sentiment_results row', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([{ id: 'sig-1' }, { id: 'sig-2' }]);

    const result = await reconcilePendingSignals();

    expect(result).toEqual({ pending: 2, published: 2 });
    expect(mockPublish).toHaveBeenCalledWith('item', 'sig-1');
    expect(mockPublish).toHaveBeenCalledWith('item', 'sig-2');
  });

  it('is a no-op when nothing is pending', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([]);

    const result = await reconcilePendingSignals();

    expect(result).toEqual({ pending: 0, published: 0 });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('bounds the sweep so a large backlog cannot exceed the request timeout', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([]);

    await reconcilePendingSignals(250);

    expect(chain.limit).toHaveBeenCalledWith(250);
  });
});

describe('adapter registry', () => {
  /**
   * The registry and `COLLECTING_SOURCES` must agree exactly.
   *
   * The API validates new source configs against that list. If an adapter is added here without
   * updating it, the collector exists but the API refuses to configure it — a feature that is
   * built and unreachable. If one is removed without updating it, the API happily accepts a
   * source whose every collection run throws "No adapter for source", and that error is counted
   * as a failed source and dropped, so nobody is told. Both directions fail silently, which is
   * why this is a test rather than a comment.
   */
  it('matches COLLECTING_SOURCES exactly', async () => {
    const { COLLECTING_SOURCES } = await import('@project-signal/shared-types');
    const { ADAPTER_SOURCES } = await import('../src/handler.js');
    expect([...ADAPTER_SOURCES].sort()).toEqual([...COLLECTING_SOURCES].sort());
  });
});

/**
 * Many feeds of one source type.
 *
 * These two properties only matter once a brand can have more than one RSS feed, and both were
 * wrong the moment that became possible.
 */
/**
 * Does a captured drizzle predicate mention this column?
 *
 * `eq(col, value)` keeps the column object inside the SQL it builds, so a sentinel column
 * survives into the structure and can be found by walking it. Depth-limited and cycle-safe
 * because drizzle's SQL objects hold back-references.
 */
function references(node: unknown, tableName: string, column: string, seen = new Set()): boolean {
  if (!node || typeof node !== 'object' || seen.has(node)) return false;
  seen.add(node);
  const rec = node as Record<string, unknown>;
  if (rec['__table'] === tableName && rec['__col'] === column) return true;
  for (const value of Object.values(rec)) {
    if (Array.isArray(value)) {
      if (value.some((v) => references(v, tableName, column, seen))) return true;
    } else if (references(value, tableName, column, seen)) return true;
  }
  return false;
}

describe('one brand, several feeds of the same type', () => {
  const rssA = { ...cfg, id: 'cfg-a', source: 'rss', config: { feedUrl: 'https://a/feed' } };

  it('takes the watermark from THIS feed, not from every feed of the type', async () => {
    /* The defect. `since` used to be max(published_at) across the brand and the source TYPE, so a
       busy Google News feed collecting hourly pushed the watermark to now — and a quieter feed on
       the same brand then had everything it published filtered out as too old, on every run,
       forever. It reads as nobody talking about the brand, which is the one thing this product
       must never get wrong. */
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    const mine = new Date('2026-05-01T00:00:00.000Z');
    chain._wheres.length = 0;
    chain._queue.push([rssA], [brand], [{ latest: mine }]);
    chain.returning.mockResolvedValue([]);
    mockFetch.mockResolvedValue({ items: [] });

    await handleIngestionJob('cfg-a');

    /* The adapter is handed the cutoff belonging to this feed's own signals. */
    expect(mockFetch.mock.calls[0]![1]).toEqual(mine);

    /* And — the part that actually distinguishes the fix from the defect — the query that
       produced it filtered on `source_config_id`. A mock database ignores predicates, so
       asserting only on the value above passes just as happily against the old per-source-type
       query. It did, when these tests were first written. */
    const predicates = (chain._wheres as unknown[]).filter((w) =>
      references(w, 'signals', 'sourceConfigId'),
    );
    expect(predicates.length, 'the watermark must be scoped to this feed').toBeGreaterThan(0);
    expect(
      (chain._wheres as unknown[]).some((w) => references(w, 'signals', 'source')),
      'and must NOT be scoped to the source type',
    ).toBe(false);
  });

  it('passes no cutoff at all for a feed that has collected nothing yet', async () => {
    /* A brand-new feed must sweep its full history rather than start from the newest signal some
       OTHER feed happened to collect a minute ago. */
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([rssA], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValue([]);
    mockFetch.mockResolvedValue({ items: [] });

    await handleIngestionJob('cfg-a');

    expect(mockFetch.mock.calls[0]![1]).toBeUndefined();
  });

  it('stamps every signal with the feed that produced it', async () => {
    /* Without this, `source` says "rss" and six feeds are indistinguishable — you cannot tell
       which is carrying the coverage, which is dead, or which one a finding came from. */
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([rssA], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValueOnce([{ id: 'signal-1' }]);
    chain.returning.mockResolvedValue([]);

    mockFetch.mockResolvedValue({
      items: [{ externalId: 'x1', url: 'https://a/1', publishedAt: now, text: 't', metadata: {} }],
    });
    mockToSignal.mockReturnValue({
      brandEntityId: 'brand-1',
      tenantId: 'tenant-1',
      source: 'rss',
    });

    await handleIngestionJob('cfg-a');

    const inserted = chain.values.mock.calls.map((c: unknown[]) => c[0]) as Record<string, unknown>[];
    const signalRow = inserted.find((row) => row['rawStorageRef'] !== undefined);
    expect(signalRow?.['sourceConfigId']).toBe('cfg-a');
  });
});

describe('reddit', () => {
  it('is in the adapter registry', async () => {
    const { ADAPTER_SOURCES } = await import('../src/handler.js');
    expect(ADAPTER_SOURCES).toContain('reddit');
  });

  it('collects through the Apify key, with no second credential to provision', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push(
      [{ ...cfg, id: 'cfg-r', source: 'reddit', config: { query: '"Tes MyConcern"' } }],
      [brand],
      [{ latest: null }],
    );
    chain.returning.mockResolvedValue([]);
    mockFetch.mockResolvedValue({ items: [] });

    await handleIngestionJob('cfg-r');

    const adapterConfig = mockFetch.mock.calls[0]![0] as { credentials: Record<string, string> };
    expect(adapterConfig.credentials['apifyApiKey']).toBe('apify-key');
    /* And the per-brand config travels alongside it. */
    expect(adapterConfig.credentials['query']).toBe('"Tes MyConcern"');
  });
});

/**
 * A failed feed must say so on its own row.
 *
 * `lastFetchedAt` is written only at the END of a successful run, so a feed whose adapter throws
 * never gets a timestamp — and the UI, which had only that column to read, showed **"never run"**
 * forever. The owner saw five feeds marked "never run" after twelve hourly scans had each
 * attempted and failed them. A feed that is broken and a feed that has never been tried need
 * completely different responses, and the old data made them identical.
 */
describe('recording what happened to a feed', () => {
  /** The `set()` payloads written to source_configs during this call. */
  function updates(chain: { set: { mock: { calls: unknown[][] } } }): Record<string, unknown>[] {
    return chain.set.mock.calls.map((c) => c[0] as Record<string, unknown>);
  }

  it('stamps the attempt BEFORE fetching, so a throw still leaves a trace', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValue([]);
    mockFetch.mockRejectedValue(new Error('Apify start run failed: 401'));

    await expect(handleIngestionJob('cfg-1')).rejects.toThrow(/401/);

    const attempted = updates(chain).filter((u) => u['lastAttemptedAt'] instanceof Date);
    expect(attempted, 'the attempt must be recorded even though the fetch threw').toHaveLength(1);
  });

  it('records the reason on the row, not only in the scan summary', async () => {
    /* The scan aggregates every failure into one string on `scan_runs`, which says something
       broke but never which feed. This puts it on the row the user has to fix. */
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValue([]);
    mockFetch.mockRejectedValue(new Error('Apify start run failed: 401'));

    await expect(handleIngestionJob('cfg-1')).rejects.toThrow();

    const failure = updates(chain).find((u) => typeof u['lastError'] === 'string');
    expect(failure?.['lastError']).toMatch(/Apify start run failed: 401/);
  });

  it('still rethrows, so the scan counts the source as failed', async () => {
    /* Swallowing the error here would make a scan report 7/7 sources succeeded while collecting
       nothing — a worse lie than the one being fixed. */
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValue([]);
    mockFetch.mockRejectedValue(new Error('boom'));

    await expect(handleIngestionJob('cfg-1')).rejects.toThrow('boom');
  });

  it('truncates a long error rather than putting a stack trace in a table cell', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValue([]);
    mockFetch.mockRejectedValue(new Error('x'.repeat(5000)));

    await expect(handleIngestionJob('cfg-1')).rejects.toThrow();

    const failure = updates(chain).find((u) => typeof u['lastError'] === 'string');
    expect((failure?.['lastError'] as string).length).toBeLessThanOrEqual(400);
  });

  it('CLEARS the error when a feed recovers', async () => {
    /* Otherwise a feed that started working keeps showing the failure it had three days ago, and
       the panel fills with stale alarms nobody trusts. */
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([cfg], [brand], [{ latest: null }]);
    chain.returning.mockResolvedValue([]);
    mockFetch.mockResolvedValue({ items: [] });

    await handleIngestionJob('cfg-1');

    const success = updates(chain).find((u) => u['lastFetchedAt'] instanceof Date);
    expect(success).toBeDefined();
    expect(success?.['lastError'], 'a recovered feed must stop reporting its old failure').toBeNull();
  });
});
