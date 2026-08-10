import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedditAdapter } from '../src/reddit.js';

vi.mock('../src/apifyClient.js', () => ({
  startApifyRun: vi.fn(),
  waitForApifyRun: vi.fn(),
  fetchApifyDataset: vi.fn(),
}));

import { startApifyRun, waitForApifyRun, fetchApifyDataset } from '../src/apifyClient.js';

/**
 * The Reddit adapter.
 *
 * Reddit was never in this codebase at all — not in `SignalSource`, not in `COLLECTING_SOURCES`,
 * no adapter file. It is where an education brand is discussed unprompted, which is exactly the
 * conversation the other five sources cannot see.
 *
 * The fixture below is REAL. It is two rows taken verbatim from a live run of
 * `trudax/reddit-scraper-lite` against this project's own Apify account on 2026-08-09 — the field
 * names, the shapes and the ISO timestamps are what the actor actually returns, not what its
 * documentation implies. This repository has twice shipped a model id written from memory; an
 * actor's output schema decays exactly the same way, and a test built on invented field names
 * passes forever while the adapter collects nothing.
 */

const adapter = new RedditAdapter();

const config = {
  brandEntityId: 'brand-1',
  tenantId: 'tenant-1',
  source: 'reddit' as const,
  credentials: { apifyApiKey: 'key-123', query: '"Tes MyConcern"' },
};

/** Verbatim shape from a live run — see the note above. */
const POST = {
  id: 't3_1u43jul',
  parsedId: '1u43jul',
  url: 'https://www.reddit.com/r/TeachingUK/comments/1u43jul/safeguarding_software/',
  username: 'Running_Lama',
  title: 'Safeguarding software — anyone else?',
  communityName: 'r/TeachingUK',
  parsedCommunityName: 'TeachingUK',
  body: 'We switched last term and the reporting is much better.',
  html: '<div>…</div>',
  createdAt: '2026-06-12T18:29:02.000Z',
  scrapedAt: '2026-08-09T23:07:59.826Z',
  dataType: 'post',
};

function dataset(items: unknown[]) {
  vi.mocked(fetchApifyDataset).mockResolvedValue(items as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startApifyRun).mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' });
  vi.mocked(waitForApifyRun).mockResolvedValue({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' });
  dataset([]);
});

/** The input object handed to Apify on the most recent call. */
function actorInput(): Record<string, unknown> {
  return vi.mocked(startApifyRun).mock.calls[0]![2] as Record<string, unknown>;
}

describe('RedditAdapter', () => {
  it('is the reddit source', () => {
    expect(adapter.source).toBe('reddit');
  });

  it('goes through the Apify account that already exists', async () => {
    await adapter.fetch(config);
    expect(vi.mocked(startApifyRun).mock.calls[0]![0]).toBe('key-123');
    expect(vi.mocked(startApifyRun).mock.calls[0]![1]).toBe('trudax~reddit-scraper-lite');
  });

  it('refuses to run without a search term', async () => {
    await expect(
      adapter.fetch({ ...config, credentials: { apifyApiKey: 'k' } }),
    ).rejects.toThrow(/query required/);
  });

  it('refuses to run without a key', async () => {
    await expect(
      adapter.fetch({ ...config, credentials: { query: 'x' } }),
    ).rejects.toThrow(/apifyApiKey required/);
  });

  it('asks for posts only', async () => {
    /* Comments would multiply volume by an order of magnitude and arrive without the context that
       makes them scoreable — a two-word reply is not a signal. */
    await adapter.fetch(config);
    const input = actorInput();
    expect(input['searchPosts']).toBe(true);
    expect(input['searchComments']).toBe(false);
    expect(input['skipComments']).toBe(true);
  });

  it('sorts by new, so a capped run returns the most recent items', async () => {
    await adapter.fetch(config);
    expect(actorInput()['sort']).toBe('new');
  });

  it('scopes to a subreddit when one is given', async () => {
    await adapter.fetch({ ...config, credentials: { ...config.credentials, subreddit: 'TeachingUK' } });
    expect(actorInput()['searchCommunityName']).toBe('TeachingUK');
  });

  it('accepts a subreddit written as r/Name or /r/Name', async () => {
    /* Which is how a person writes it, and how it appears everywhere on Reddit itself. Passing
       the prefix through returns nothing at all, silently. */
    await adapter.fetch({ ...config, credentials: { ...config.credentials, subreddit: 'r/TeachingUK' } });
    expect(actorInput()['searchCommunityName']).toBe('TeachingUK');
  });

  it('searches all of Reddit when no subreddit is given', async () => {
    await adapter.fetch(config);
    expect(actorInput()).not.toHaveProperty('searchCommunityName');
  });

  it('caps the item count however large a number is configured', async () => {
    await adapter.fetch({ ...config, credentials: { ...config.credentials, maxItems: '99999' } });
    expect(actorInput()['maxItems']).toBe(200);
  });

  it('maps a real post to a raw item', async () => {
    dataset([POST]);
    const { items } = await adapter.fetch(config);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: 't3_1u43jul',
      url: 'https://www.reddit.com/r/TeachingUK/comments/1u43jul/safeguarding_software/',
      publishedAt: new Date('2026-06-12T18:29:02.000Z'),
    });
    expect(items[0]!.metadata).toMatchObject({ community: 'TeachingUK', author: 'Running_Lama' });
  });

  it('scores the title AND the body', async () => {
    /* A Reddit post is very often a title alone. Taking only the body would discard the entire
       signal in the most common case. */
    dataset([POST]);
    const { items } = await adapter.fetch(config);
    expect(items[0]!.text).toContain('Safeguarding software');
    expect(items[0]!.text).toContain('reporting is much better');
  });

  it('keeps a post that is a title with no body', async () => {
    dataset([{ ...POST, body: '' }]);
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe('Safeguarding software — anyone else?');
  });

  it('uses the fullname as the external id, not the short id', async () => {
    /* `parsedId` is unique only within a type, so a post and a comment could collide on it — and
       signals are de-duplicated on externalId. */
    dataset([POST]);
    const { items } = await adapter.fetch(config);
    expect(items[0]!.externalId).toBe('t3_1u43jul');
  });

  it('drops comments even if the actor returns them', async () => {
    dataset([POST, { ...POST, id: 't1_x', dataType: 'comment', title: '', body: 'agreed' }]);
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
  });

  it('drops a row with no usable text', async () => {
    dataset([{ ...POST, title: '', body: '' }]);
    const { items } = await adapter.fetch(config);
    expect(items).toEqual([]);
  });

  it('drops a row with no id, rather than storing an empty external id', async () => {
    /* An empty externalId collapses every such row onto one storage key and one dedup slot. */
    dataset([{ ...POST, id: undefined, parsedId: undefined }]);
    const { items } = await adapter.fetch(config);
    expect(items).toEqual([]);
  });

  it('filters out anything older than the watermark', async () => {
    dataset([POST]);
    const { items } = await adapter.fetch(config, new Date('2026-07-01T00:00:00.000Z'));
    expect(items).toEqual([]);
  });

  it('keeps anything newer than the watermark', async () => {
    dataset([POST]);
    const { items } = await adapter.fetch(config, new Date('2026-01-01T00:00:00.000Z'));
    expect(items).toHaveLength(1);
  });

  it('survives an actor build that stops sending a field', async () => {
    /* Every field is optional in the interface for this reason. A crash here is recorded by the
       dispatcher as "source failed" with nothing to explain it. */
    dataset([{ title: 'Just a title', id: 't3_z' }]);
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe('');
  });

  it('produces a signal carrying the tenant and brand', async () => {
    dataset([POST]);
    const { items } = await adapter.fetch(config);
    const signal = adapter.toSignal(items[0]!, config);

    expect(signal).toMatchObject({
      tenantId: 'tenant-1',
      brandEntityId: 'brand-1',
      source: 'reddit',
    });
  });
});
