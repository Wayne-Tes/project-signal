import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPublishMessage, mockTopic, mockFetch, mockToSignal, mockPut } = vi.hoisted(() => ({
  mockPublishMessage: vi.fn().mockResolvedValue('msg-id'),
  mockTopic: vi.fn(),
  mockFetch: vi.fn(),
  mockToSignal: vi.fn(),
  mockPut: vi.fn(),
}));

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  let _rows: unknown[] = [];
  const queue: unknown[][] = [];
  ['select', 'from', 'where', 'insert', 'values', 'update', 'set', 'leftJoin', 'limit'].forEach(
    (m) => {
      chain[m] = vi.fn(() => chain);
    },
  );
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
    brandEntities: {},
    signals: {},
    sentimentResults: {},
    sourceConfigs: {},
    client: { get: vi.fn() },
  };
});

vi.mock('@project-signal/messaging', () => ({
  getPubSub: vi.fn(() => ({ topic: mockTopic })),
  topicName: vi.fn(() => 'staging-item'),
  TOPICS: { ITEM_QUEUE: 'project-signal-item-queue' },
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
  mockTopic.mockReturnValue({ publishMessage: mockPublishMessage });
  const { db } = await import('@project-signal/db');
  const chain = db.get() as any;
  chain._setRows([]);
  chain._queue.length = 0;
});

describe('handleIngestionJob', () => {
  it('fetches, inserts signals, and publishes to PubSub', async () => {
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
    expect(mockPublishMessage).toHaveBeenCalledWith({ data: Buffer.from('signal-new-1') });
  });

  // KNOWN-GAPS #7 — publishing to the hardcoded constant targeted a topic Terraform never
  // created. The name must come from topicName(), which reads ITEM_TOPIC.
  it('publishes to the topic resolved from the environment, not the local constant', async () => {
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

    expect(mockTopic).toHaveBeenCalledWith('staging-item');
    expect(mockTopic).not.toHaveBeenCalledWith('project-signal-item-queue');
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
    expect(mockPublishMessage).not.toHaveBeenCalled();
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
    expect(mockPublishMessage).not.toHaveBeenCalled();
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
    expect(mockTopic).toHaveBeenCalledWith('staging-item');
    expect(mockPublishMessage).toHaveBeenCalledWith({ data: Buffer.from('sig-1') });
    expect(mockPublishMessage).toHaveBeenCalledWith({ data: Buffer.from('sig-2') });
  });

  it('is a no-op when nothing is pending', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([]);

    const result = await reconcilePendingSignals();

    expect(result).toEqual({ pending: 0, published: 0 });
    expect(mockPublishMessage).not.toHaveBeenCalled();
  });

  it('bounds the sweep so a large backlog cannot exceed the request timeout', async () => {
    const { db } = await import('@project-signal/db');
    const chain = db.get() as any;
    chain._queue.push([]);

    await reconcilePendingSignals(250);

    expect(chain.limit).toHaveBeenCalledWith(250);
  });
});
