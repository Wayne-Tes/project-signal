import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleReviewsAdapter } from '../src/googleReviews.js';

vi.mock('../src/apifyClient.js', () => ({
  startApifyRun: vi.fn(),
  waitForApifyRun: vi.fn(),
  fetchApifyDataset: vi.fn(),
}));

import { startApifyRun, waitForApifyRun, fetchApifyDataset } from '../src/apifyClient.js';

const adapter = new GoogleReviewsAdapter();

const config = {
  brandEntityId: 'brand-1',
  tenantId: 'tenant-1',
  source: 'google_reviews' as const,
  credentials: { apifyApiKey: 'key-123', placeId: 'ChIJ123' },
};

beforeEach(() => {
  vi.mocked(startApifyRun).mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' });
  vi.mocked(waitForApifyRun).mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' });
  vi.mocked(fetchApifyDataset).mockResolvedValue([]);
});

describe('GoogleReviewsAdapter', () => {
  it('source is google_reviews', () => {
    expect(adapter.source).toBe('google_reviews');
  });

  it('starts an Apify run with placeId in input', async () => {
    await adapter.fetch(config);
    expect(startApifyRun).toHaveBeenCalledWith(
      'key-123',
      'compass~google-maps-reviews-scraper',
      expect.objectContaining({ placeIds: ['ChIJ123'], maxReviews: 100 }),
    );
  });

  it('includes cutoffDate when since is provided', async () => {
    const since = new Date('2024-01-15T00:00:00Z');
    await adapter.fetch(config, since);
    expect(startApifyRun).toHaveBeenCalledWith(
      'key-123',
      expect.any(String),
      expect.objectContaining({ cutoffDate: '2024-01-15' }),
    );
  });

  it('maps Apify reviews to RawItems', async () => {
    vi.mocked(fetchApifyDataset).mockResolvedValue([
      {
        reviewId: 'rev-1',
        reviewUrl: 'https://maps.google.com/review/1',
        text: 'Excellent service!',
        publishedAtDate: '2024-03-01T10:00:00Z',
        stars: 5,
        name: 'Alice',
      },
    ]);
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('Excellent service!');
    expect(items[0]?.externalId).toBe('rev-1');
    expect(items[0]?.metadata).toMatchObject({ stars: 5, reviewerName: 'Alice' });
  });

  it('throws when apifyApiKey is missing', async () => {
    const badConfig = { ...config, credentials: { placeId: 'ChIJ123' } };
    await expect(adapter.fetch(badConfig)).rejects.toThrow('apifyApiKey');
  });

  it('throws when placeId is missing', async () => {
    const badConfig = { ...config, credentials: { apifyApiKey: 'key' } };
    await expect(adapter.fetch(badConfig)).rejects.toThrow('placeId');
  });

  it('toSignal maps item to signal shape', () => {
    const item = {
      externalId: 'rev-1',
      url: 'https://maps.google.com/review/1',
      text: 'Great!',
      publishedAt: new Date('2024-03-01'),
      metadata: {},
    };
    const signal = adapter.toSignal(item, config);
    expect(signal.source).toBe('google_reviews');
    expect(signal.tenantId).toBe('tenant-1');
    expect(signal.brandEntityId).toBe('brand-1');
    expect(signal.sourceUrl).toBe(item.url);
    expect(signal.publishedAt).toEqual(item.publishedAt);
  });
});
