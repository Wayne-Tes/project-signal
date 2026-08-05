import type { Signal } from '@project-signal/shared-types';
import type { SourceAdapter, AdapterConfig, FetchResult, RawItem } from './index.js';

const YT_API = 'https://www.googleapis.com/youtube/v3';
const MAX_VIDEOS = 10;
const MAX_COMMENTS_PER_VIDEO = 50;

interface SearchItem {
  id: { videoId: string };
  snippet: { title: string; publishedAt: string };
}

interface SearchResponse {
  items?: SearchItem[];
}

interface CommentThread {
  snippet: {
    topLevelComment: {
      id: string;
      snippet: {
        textOriginal: string;
        authorDisplayName: string;
        likeCount: number;
        publishedAt: string;
      };
    };
  };
}

interface CommentsResponse {
  items?: CommentThread[];
}

export class YoutubeAdapter implements SourceAdapter {
  readonly source = 'youtube' as const;

  async fetch(config: AdapterConfig, since?: Date): Promise<FetchResult> {
    const apiKey = config.credentials?.['youtubeApiKey'];
    const channelId = config.credentials?.['channelId'];
    if (!apiKey) throw new Error('youtubeApiKey required in credentials');
    if (!channelId) throw new Error('channelId required in credentials');

    const videos = await fetchRecentVideos(apiKey, channelId, since);
    const items: RawItem[] = [];

    for (const video of videos) {
      const comments = await fetchComments(apiKey, video.id.videoId);
      for (const thread of comments) {
        const c = thread.snippet.topLevelComment;
        items.push({
          externalId: c.id,
          url: `https://www.youtube.com/watch?v=${video.id.videoId}&lc=${c.id}`,
          text: c.snippet.textOriginal,
          publishedAt: new Date(c.snippet.publishedAt),
          metadata: {
            videoId: video.id.videoId,
            videoTitle: video.snippet.title,
            likeCount: c.snippet.likeCount,
            authorName: c.snippet.authorDisplayName,
          },
        });
      }
    }

    return { items };
  }

  toSignal(item: RawItem, config: AdapterConfig): Omit<Signal, 'id' | 'ingestedAt' | 'rawStorageRef'> {
    return {
      tenantId: config.tenantId,
      brandEntityId: config.brandEntityId,
      source: this.source,
      sourceUrl: item.url,
      publishedAt: item.publishedAt,
    };
  }
}

async function fetchRecentVideos(
  apiKey: string,
  channelId: string,
  since?: Date,
): Promise<SearchItem[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    channelId,
    type: 'video',
    order: 'date',
    maxResults: String(MAX_VIDEOS),
    key: apiKey,
  });
  if (since) params.set('publishedAfter', since.toISOString());

  const res = await fetch(`${YT_API}/search?${params}`);
  if (!res.ok) throw new Error(`YouTube search failed: ${res.status}`);
  const data = (await res.json()) as SearchResponse;
  return data.items ?? [];
}

async function fetchComments(apiKey: string, videoId: string): Promise<CommentThread[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    videoId,
    maxResults: String(MAX_COMMENTS_PER_VIDEO),
    order: 'time',
    key: apiKey,
  });

  const res = await fetch(`${YT_API}/commentThreads?${params}`);
  // Comments disabled on this video — not an error, just skip
  if (res.status === 403) return [];
  if (!res.ok) throw new Error(`YouTube comments failed: ${res.status} for video ${videoId}`);
  const data = (await res.json()) as CommentsResponse;
  return data.items ?? [];
}
