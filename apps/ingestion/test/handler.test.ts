import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPublishMessage, mockTopic, mockFetch, mockToSignal } = vi.hoisted(() => ({
  mockPublishMessage: vi.fn().mockResolvedValue('msg-id'),
  mockTopic: vi.fn(),
  mockFetch: vi.fn(),
  mockToSignal: vi.fn(),
}));

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  let _rows: unknown[] = [];
  const queue: unknown[][] = [];
  ['select', 'from', 'where', 'insert', 'values', 'update', 'set']
    .forEach(m => { chain[m] = vi.fn(() => chain); });
  const nextRows = () => (queue.length ? queue.shift()! : _rows);
  chain['onConflictDoNothing'] = vi.fn(() => chain);
  chain['returning'] = vi.fn(() => Promise.resolve(nextRows()));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(nextRows()).then(r as never, j as never);
  (chain as any)._setRows = (rows: unknown[]) => { _rows = rows; };
  (chain as any)._queue = queue;
  return {
    db: { get: vi.fn(() => chain) },
    brandEntities: {}, signals: {}, sourceConfigs: {},
    client: { get: vi.fn() },
  };
});

vi.mock('@project-signal/messaging', () => ({
  getPubSub: vi.fn(() => ({ topic: () => ({ publishMessage: mockPublishMessage }) })),
  TOPICS: { ITEM_QUEUE: 'item-queue' },
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

import { handleIngestionJob } from '../src/handler.js';

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
const brand = { id: 'brand-1', tenantId: 'tenant-1', name: 'Acme', slug: 'acme', isOwned: true, createdAt: now, updatedAt: now };

beforeEach(async () => {
  vi.clearAllMocks();
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
    mockToSignal.mockReturnValue({ brandEntityId: 'brand-1', tenantId: 'tenant-1', source: 'google_reviews' });

    const result = await handleIngestionJob('cfg-1');

    expect(result.signalsCreated).toBe(1);
    expect(result.signalsPublished).toBe(1);
    expect(mockPublishMessage).toHaveBeenCalledWith({ data: Buffer.from('signal-new-1') });
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
    mockToSignal.mockReturnValue({ brandEntityId: 'brand-1', tenantId: 'tenant-1', source: 'google_reviews' });

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
      expect.objectContaining({ credentials: expect.objectContaining({ apifyApiKey: 'apify-key' }) }),
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
      expect.objectContaining({ credentials: expect.objectContaining({ youtubeApiKey: 'yt-key' }) }),
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
      expect.objectContaining({ credentials: expect.objectContaining({ apifyApiKey: 'apify-key' }) }),
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
      expect.objectContaining({ credentials: expect.objectContaining({ apifyApiKey: 'apify-key' }) }),
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
