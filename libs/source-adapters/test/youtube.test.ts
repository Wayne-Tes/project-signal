import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YoutubeAdapter } from '../src/youtube.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const adapter = new YoutubeAdapter();

const config = {
  brandEntityId: 'brand-1',
  tenantId: 'tenant-1',
  source: 'youtube' as const,
  credentials: { youtubeApiKey: 'yt-key-123', channelId: 'UCxxx' },
};

const videoSearchResponse = {
  items: [
    {
      id: { videoId: 'vid-1' },
      snippet: { title: 'First Video', publishedAt: '2024-01-01T00:00:00Z' },
    },
    {
      id: { videoId: 'vid-2' },
      snippet: { title: 'Second Video', publishedAt: '2024-01-02T00:00:00Z' },
    },
  ],
};

function makeComment(id: string, text: string, publishedAt = '2024-01-01T10:00:00Z') {
  return {
    snippet: {
      topLevelComment: {
        id,
        snippet: { textOriginal: text, authorDisplayName: 'User', likeCount: 0, publishedAt },
      },
    },
  };
}

const commentsResponse = {
  items: [makeComment('c1', 'Great video!'), makeComment('c2', 'Loved it')],
};

describe('YoutubeAdapter', () => {
  it('source is youtube', () => {
    expect(adapter.source).toBe('youtube');
  });

  it('fetches videos then comments for each video', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(videoSearchResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(commentsResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(commentsResponse),
      });

    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(4); // 2 comments per video × 2 videos
    expect(items[0]?.text).toBe('Great video!');
  });

  it('does NOT restrict the video search by the comment watermark', async () => {
    /* The defect: `since` is the newest stored COMMENT's date, and was sent as the video search's
       `publishedAfter`. After one run, only videos uploaded after the latest comment were searched,
       so new comments on every existing video were never collected again. */
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ items: [] }),
    });

    await adapter.fetch(config, new Date('2024-01-15T00:00:00Z'));
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).not.toContain('publishedAfter');
  });

  it('collects NEW comments on an OLD video, filtering by the comment date', async () => {
    const since = new Date('2024-03-01T00:00:00Z');
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [videoSearchResponse.items[0]] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            items: [
              makeComment('old', 'Seen already', '2024-02-01T00:00:00Z'),
              makeComment('new', 'Still broken in March', '2024-03-05T00:00:00Z'),
            ],
          }),
      });

    const { items } = await adapter.fetch(config, since);
    expect(items.map((i) => i.externalId)).toEqual(['new']);
  });

  it('drops comments with no text left after stripping', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [videoSearchResponse.items[0]] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ items: [makeComment('blank', '   '), makeComment('c', 'Words')] }),
      });

    const { items } = await adapter.fetch(config);
    expect(items.map((i) => i.externalId)).toEqual(['c']);
  });

  it('skips a video whose comments are disabled', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(videoSearchResponse),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { errors: [{ reason: 'commentsDisabled' }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(commentsResponse),
      });

    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(2); // Only second video's comments
  });

  it('FAILS on any other 403, such as an exhausted quota', async () => {
    /* Every 403 used to be read as "comments disabled", so a key out of quota looked like a
       channel whose every video had comments turned off — a green feed collecting nothing. */
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [videoSearchResponse.items[0]] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: { errors: [{ reason: 'quotaExceeded' }] } }),
      });

    await expect(adapter.fetch(config)).rejects.toThrow('403 (quotaExceeded)');
  });

  it('fails on a 403 whose body carries no reason, rather than assuming', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [videoSearchResponse.items[0]] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.reject(new Error('not json')),
      });

    await expect(adapter.fetch(config)).rejects.toThrow(/refused: 403 for video vid-1/);
  });

  it('names the reason when the search itself is refused', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { errors: [{ reason: 'keyInvalid' }] } }),
    });
    await expect(adapter.fetch(config)).rejects.toThrow('YouTube search failed: 403 (keyInvalid)');
  });

  it('sets a timeout on every request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ items: [] }),
    });
    await adapter.fetch(config);
    expect((mockFetch.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on non-403 error fetching comments', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [videoSearchResponse.items[0]] }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) });

    await expect(adapter.fetch(config)).rejects.toThrow('500');
  });

  it('throws when youtubeApiKey is missing', async () => {
    await expect(adapter.fetch({ ...config, credentials: { channelId: 'UCxxx' } })).rejects.toThrow(
      'youtubeApiKey',
    );
  });

  it('throws when channelId is missing', async () => {
    await expect(
      adapter.fetch({ ...config, credentials: { youtubeApiKey: 'key' } }),
    ).rejects.toThrow('channelId');
  });

  it('toSignal includes video and comment URL', () => {
    const item = {
      externalId: 'c1',
      url: 'https://www.youtube.com/watch?v=vid-1&lc=c1',
      text: 'Great!',
      publishedAt: new Date('2024-01-01'),
      metadata: { videoId: 'vid-1', videoTitle: 'Test' },
    };
    const signal = adapter.toSignal(item, config);
    expect(signal.source).toBe('youtube');
    expect(signal.sourceUrl).toBe(item.url);
    expect(signal.brandEntityId).toBe('brand-1');
  });
});
