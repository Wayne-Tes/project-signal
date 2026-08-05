import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayStoreAdapter } from '../src/playStore.js';

vi.mock('../src/apifyClient.js', () => ({
  startApifyRun: vi.fn(),
  waitForApifyRun: vi.fn(),
  fetchApifyDataset: vi.fn(),
}));

import { startApifyRun, waitForApifyRun, fetchApifyDataset } from '../src/apifyClient.js';

const adapter = new PlayStoreAdapter();

const config = {
  brandEntityId: 'brand-1',
  tenantId: 'tenant-1',
  source: 'play_store' as const,
  credentials: { apifyApiKey: 'key-123', appId: 'com.example.app' },
};

beforeEach(() => {
  vi.mocked(startApifyRun).mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' });
  vi.mocked(waitForApifyRun).mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' });
  vi.mocked(fetchApifyDataset).mockResolvedValue([]);
});

describe('PlayStoreAdapter', () => {
  it('source is play_store', () => {
    expect(adapter.source).toBe('play_store');
  });

  it('calls the Play Store Apify actor with sort=newest', async () => {
    await adapter.fetch(config);
    expect(startApifyRun).toHaveBeenCalledWith(
      'key-123',
      'emastra~google-play-scraper',
      expect.objectContaining({ appId: 'com.example.app', sort: 'newest' }),
    );
  });

  it('includes startDate when since is provided', async () => {
    const since = new Date('2024-03-05T00:00:00Z');
    await adapter.fetch(config, since);
    expect(startApifyRun).toHaveBeenCalledWith(
      'key-123',
      expect.any(String),
      expect.objectContaining({ startDate: '2024-03-05' }),
    );
  });

  it('filters out reviews without content', async () => {
    vi.mocked(fetchApifyDataset).mockResolvedValue([
      { reviewId: 'r1', content: 'Great!', score: 5, at: '2024-01-01' },
      { reviewId: 'r2', content: '', score: 3, at: '2024-01-02' },
      { reviewId: 'r3', score: 2, at: '2024-01-03' },
    ]);
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('Great!');
  });

  it('falls back to appId-based URL when appUrl is missing', async () => {
    vi.mocked(fetchApifyDataset).mockResolvedValue([
      { reviewId: 'r1', content: 'Nice!', score: 5, at: '2024-01-01', appId: 'com.example.app' },
    ]);
    const { items } = await adapter.fetch(config);
    expect(items[0]?.url).toContain('com.example.app');
  });

  it('throws when apifyApiKey is missing', async () => {
    await expect(adapter.fetch({ ...config, credentials: { appId: 'x' } })).rejects.toThrow('apifyApiKey');
  });

  it('throws when appId is missing', async () => {
    await expect(adapter.fetch({ ...config, credentials: { apifyApiKey: 'k' } })).rejects.toThrow('appId');
  });

  it('toSignal maps item to signal shape', () => {
    const item = { externalId: 'r1', url: 'https://play.google.com/...', text: 'Good', publishedAt: new Date('2024-01-01'), metadata: {} };
    const signal = adapter.toSignal(item, config);
    expect(signal.source).toBe('play_store');
    expect(signal.brandEntityId).toBe('brand-1');
  });
});
