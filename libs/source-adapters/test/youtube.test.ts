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
    { id: { videoId: 'vid-1' }, snippet: { title: 'First Video', publishedAt: '2024-01-01T00:00:00Z' } },
    { id: { videoId: 'vid-2' }, snippet: { title: 'Second Video', publishedAt: '2024-01-02T00:00:00Z' } },
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
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(videoSearchResponse) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(commentsResponse) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(commentsResponse) });

    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(4); // 2 comments per video × 2 videos
    expect(items[0]?.text).toBe('Great video!');
  });

  it('includes publishedAfter param when since is provided', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) });

    const since = new Date('2024-01-15T00:00:00Z');
    await adapter.fetch(config, since);
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain('publishedAfter=2024-01-15T00%3A00%3A00.000Z');
  });

  it('skips videos where comments are disabled (403)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(videoSearchResponse) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(commentsResponse) });

    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(2); // Only second video's comments
  });

  it('throws on non-403 error fetching comments', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ items: [videoSearchResponse.items[0]] }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) });

    await expect(adapter.fetch(config)).rejects.toThrow('500');
  });

  it('throws when youtubeApiKey is missing', async () => {
    await expect(adapter.fetch({ ...config, credentials: { channelId: 'UCxxx' } })).rejects.toThrow('youtubeApiKey');
  });

  it('throws when channelId is missing', async () => {
    await expect(adapter.fetch({ ...config, credentials: { youtubeApiKey: 'key' } })).rejects.toThrow('channelId');
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
