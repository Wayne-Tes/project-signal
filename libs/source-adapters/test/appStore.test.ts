import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStoreAdapter } from '../src/appStore.js';

vi.mock('../src/apifyClient.js', () => ({
  startApifyRun: vi.fn(),
  waitForApifyRun: vi.fn(),
  fetchApifyDataset: vi.fn(),
}));

import { startApifyRun, waitForApifyRun, fetchApifyDataset } from '../src/apifyClient.js';

const adapter = new AppStoreAdapter();

const config = {
  brandEntityId: 'brand-1',
  tenantId: 'tenant-1',
  source: 'app_store' as const,
  credentials: { apifyApiKey: 'key-123', appId: 'com.example.app' },
};

beforeEach(() => {
  vi.mocked(startApifyRun).mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' });
  vi.mocked(waitForApifyRun).mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' });
  vi.mocked(fetchApifyDataset).mockResolvedValue([]);
});

describe('AppStoreAdapter', () => {
  it('source is app_store', () => {
    expect(adapter.source).toBe('app_store');
  });

  it('uses default country "us" when not specified', async () => {
    await adapter.fetch(config);
    expect(startApifyRun).toHaveBeenCalledWith(
      'key-123',
      'nikita-shakula~app-store-scraper',
      expect.objectContaining({ country: 'us', appIds: ['com.example.app'] }),
    );
  });

  it('respects country override in credentials', async () => {
    const configWithCountry = { ...config, credentials: { ...config.credentials, country: 'gb' } };
    await adapter.fetch(configWithCountry);
    expect(startApifyRun).toHaveBeenCalledWith(
      'key-123',
      expect.any(String),
      expect.objectContaining({ country: 'gb' }),
    );
  });

  it('includes startDate when since is provided', async () => {
    const since = new Date('2024-02-10T00:00:00Z');
    await adapter.fetch(config, since);
    expect(startApifyRun).toHaveBeenCalledWith(
      'key-123',
      expect.any(String),
      expect.objectContaining({ startDate: '2024-02-10' }),
    );
  });

  it('filters out reviews without text', async () => {
    vi.mocked(fetchApifyDataset).mockResolvedValue([
      { id: '1', url: 'https://example.com', text: 'Good app', score: 5, date: '2024-01-01' },
      { id: '2', url: 'https://example.com', text: '', score: 3, date: '2024-01-02' },
      { id: '3', url: 'https://example.com', score: 4, date: '2024-01-03' },
    ]);
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain('Good app');
  });

  it('concatenates title and text', async () => {
    vi.mocked(fetchApifyDataset).mockResolvedValue([
      { id: '1', url: 'u', title: 'Amazing!', text: 'Really great.', score: 5, date: '2024-01-01' },
    ]);
    const { items } = await adapter.fetch(config);
    expect(items[0]?.text).toContain('Amazing!');
    expect(items[0]?.text).toContain('Really great.');
  });

  it('throws when apifyApiKey is missing', async () => {
    await expect(adapter.fetch({ ...config, credentials: { appId: 'x' } })).rejects.toThrow('apifyApiKey');
  });

  it('throws when appId is missing', async () => {
    await expect(adapter.fetch({ ...config, credentials: { apifyApiKey: 'k' } })).rejects.toThrow('appId');
  });

  it('toSignal maps item to signal shape', () => {
    const item = { externalId: '1', url: 'https://example.com', text: 'Good', publishedAt: new Date('2024-01-01'), metadata: {} };
    const signal = adapter.toSignal(item, config);
    expect(signal.source).toBe('app_store');
    expect(signal.tenantId).toBe('tenant-1');
    expect(signal.brandEntityId).toBe('brand-1');
  });
});
