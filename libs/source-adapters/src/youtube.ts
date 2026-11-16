import type { Signal } from '@project-signal/shared-types';
import type { SourceAdapter, AdapterConfig, FetchResult, RawItem } from './index.js';
import { clampContent, stripHtml } from './text.js';
import { baseSignal, isUsable, newerThan } from './common.js';
import { fetchWithTimeout } from './http.js';

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

/** The `reason` on a YouTube Data API error, e.g. `commentsDisabled` or `quotaExceeded`. */
interface YoutubeErrorBody {
  error?: { errors?: { reason?: string }[]; message?: string };
}

export class YoutubeAdapter implements SourceAdapter {
  readonly source = 'youtube' as const;

  /**
   * The channel's most recent videos, and the newest comments on each.
   *
   * `since` filters COMMENTS, never videos. It used to be sent as the video search's
   * `publishedAfter` — but `since` is the newest stored COMMENT's date, so after the first run the
   * search asked only for videos uploaded after the latest comment. New comments on every video
   * already seen were never collected again: the busiest videos, the ones people keep talking
   * about, went silent first. The recent-videos window is fixed instead (`MAX_VIDEOS`), and the
   * watermark is applied to what was actually said.
   */
  async fetch(config: AdapterConfig, since?: Date): Promise<FetchResult> {
    const apiKey = config.credentials?.['youtubeApiKey'];
    const channelId = config.credentials?.['channelId'];
    if (!apiKey) throw new Error('youtubeApiKey required in credentials');
    if (!channelId) throw new Error('channelId required in credentials');

    const videos = await fetchRecentVideos(apiKey, channelId);
    const items: RawItem[] = [];

    for (const video of videos) {
      const comments = await fetchComments(apiKey, video.id.videoId);
      for (const thread of comments) {
        const c = thread.snippet.topLevelComment;
        items.push({
          externalId: c.id ?? '',
          url: `https://www.youtube.com/watch?v=${video.id.videoId}&lc=${c.id}`,
          text: clampContent(stripHtml(String(c.snippet.textOriginal ?? ''))),
          sourceText: c.snippet.textOriginal ?? undefined,
          /* The VIDEO's title, not the comment's — a comment has none, and "which video was this
             said under" is the context a channel manager needs to act on it. */
          title: video.snippet.title,
          author: c.snippet.authorDisplayName,
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

    /* An emoji-only or blank comment strips to nothing and can never be scored. */
    return { items: newerThan(items.filter(isUsable), since) };
  }

  toSignal(
    item: RawItem,
    config: AdapterConfig,
  ): Omit<Signal, 'id' | 'ingestedAt' | 'rawStorageRef'> {
    return baseSignal(this.source, item, config);
  }
}

async function fetchRecentVideos(apiKey: string, channelId: string): Promise<SearchItem[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    channelId,
    type: 'video',
    order: 'date',
    maxResults: String(MAX_VIDEOS),
    key: apiKey,
  });

  const res = await fetchWithTimeout(`${YT_API}/search?${params}`);
  if (!res.ok) throw new Error(`YouTube search failed: ${res.status}${await reasonOf(res)}`);
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

  const res = await fetchWithTimeout(`${YT_API}/commentThreads?${params}`);
  if (res.status === 403) {
    /* 403 means several different things. `commentsDisabled` is the only one that is "nothing to
       collect here"; `quotaExceeded`, `forbidden` and a restricted key all mean the whole source
       is broken. Treating every 403 as "comments off" made a key out of quota look like a channel
       whose videos all happened to have comments disabled — a green feed collecting nothing. */
    const reason = await reasonOf(res);
    if (reason === ' (commentsDisabled)') return [];
    throw new Error(`YouTube comments refused: 403${reason} for video ${videoId}`);
  }
  if (!res.ok) throw new Error(`YouTube comments failed: ${res.status} for video ${videoId}`);
  const data = (await res.json()) as CommentsResponse;
  return data.items ?? [];
}

/** The API's own reason code, as ` (reason)`, or '' if the body does not carry one. */
async function reasonOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as YoutubeErrorBody;
    const reason = body.error?.errors?.[0]?.reason;
    return reason ? ` (${reason})` : '';
  } catch {
    return '';
  }
}
