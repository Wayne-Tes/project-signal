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

/**
 * The Play Store adapter.
 *
 * IT POINTED AT AN ACTOR THAT NO LONGER EXISTS. `emastra~google-play-scraper` returns 404 from
 * `GET /v2/acts/…`, so this source could not have collected anything whatever credential was
 * configured. An actor id decays exactly like a model id, and this repository has now shipped
 * both.
 *
 * The fixture is REAL: one row from a verified run of the replacement actor against
 * `com.classcharts.android.student` on 2026-08-10. The field names are what the actor sends —
 * `body` not `content`, `rating` not `score`, `reviewer` not `userName`, and a `timestamp` in
 * epoch SECONDS — none of which match what the old code expected.
 */

/** The input handed to Apify on the most recent call. */
function actorInput(): Record<string, unknown> {
  return vi.mocked(startApifyRun).mock.calls[0]![2] as Record<string, unknown>;
}

function dataset(rows: unknown[]) {
  vi.mocked(fetchApifyDataset).mockResolvedValue(rows as never);
}

const review = {
  reviewId: 'b9030b0a-7c86-49ec-a2fd-817c0b7cf7ff',
  rating: 1,
  reviewer: 'joshua Morris',
  date: '2025-03-03',
  timestamp: 1741016914,
  body: 'When I saw the reviews I had just assumed it had been fixed by now.',
  appId: 'com.classcharts.android.student',
  appVersion: '5.0.9',
  helpfulCounts: 223,
  language: 'en',
};

describe('PlayStoreAdapter', () => {
  it('is the play_store source', () => {
    expect(adapter.source).toBe('play_store');
  });

  it('uses an actor that actually exists', async () => {
    /* Asserted explicitly because the previous id was valid once and silently stopped being so. */
    await adapter.fetch(config);
    expect(vi.mocked(startApifyRun).mock.calls[0]![1]).toBe(
      'neatrat~google-play-store-reviews-scraper',
    );
  });

  it('sends the package under the field name the actor expects', async () => {
    /* `appIdOrUrl`, not `appId`. The old code sent `appId`, which this actor ignores entirely. */
    await adapter.fetch(config);
    expect(actorInput()['appIdOrUrl']).toBe('com.example.app');
  });

  it('asks for newest first', async () => {
    await adapter.fetch(config);
    expect(actorInput()['sortBy']).toBe('newest');
  });

  it('requests at least the actor’s minimum page size', async () => {
    /* The actor rejects `reviewsPerPage` below 10 — found by having it reject 3, which is the
       sort of thing only a real call tells you. */
    await adapter.fetch(config);
    expect(Number(actorInput()['reviewsPerPage'])).toBeGreaterThanOrEqual(10);
  });

  it('refuses to run without a key or an app id', async () => {
    await expect(
      adapter.fetch({ ...config, credentials: { appId: 'x' } }),
    ).rejects.toThrow(/apifyApiKey required/);
    await expect(
      adapter.fetch({ ...config, credentials: { apifyApiKey: 'k' } }),
    ).rejects.toThrow(/appId required/);
  });

  it('maps a real review', async () => {
    dataset([review]);
    const { items } = await adapter.fetch(config);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: 'b9030b0a-7c86-49ec-a2fd-817c0b7cf7ff',
      text: 'When I saw the reviews I had just assumed it had been fixed by now.',
      url: 'https://play.google.com/store/apps/details?id=com.classcharts.android.student',
    });
    expect(items[0]!.metadata).toMatchObject({ rating: 1, reviewerName: 'joshua Morris' });
  });

  it('reads the timestamp as SECONDS, not milliseconds', async () => {
    /* Passing epoch seconds to `new Date()` unmultiplied dates every review to January 1970,
       where the watermark then filters all of them out — collecting nothing, silently. */
    dataset([review]);
    const { items } = await adapter.fetch(config);
    expect(items[0]!.publishedAt.getUTCFullYear()).toBe(2025);
  });

  it('prefers the timestamp over the date string', async () => {
    /* `date` is only `YYYY-MM-DD`, so every review from one day collapses onto midnight and the
       per-feed watermark re-collects them on every run. */
    dataset([review]);
    const { items } = await adapter.fetch(config);
    expect(items[0]!.publishedAt.toISOString()).toBe(new Date(1741016914 * 1000).toISOString());
  });

  it('drops a review with no body', async () => {
    dataset([review, { ...review, reviewId: 'r2', body: '' }, { ...review, reviewId: 'r3', body: undefined }]);
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
  });

  it('filters out anything older than the watermark', async () => {
    dataset([review]);
    const { items } = await adapter.fetch(config, new Date('2026-01-01T00:00:00Z'));
    expect(items).toEqual([]);
  });

  it('produces a signal carrying the tenant and brand', async () => {
    dataset([review]);
    const { items } = await adapter.fetch(config);
    expect(adapter.toSignal(items[0]!, config)).toMatchObject({
      tenantId: 'tenant-1',
      brandEntityId: 'brand-1',
      source: 'play_store',
    });
  });
});
