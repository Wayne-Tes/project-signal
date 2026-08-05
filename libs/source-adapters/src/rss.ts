import { XMLParser } from 'fast-xml-parser';
import type { Signal } from '@project-signal/shared-types';
import type { SourceAdapter, AdapterConfig, FetchResult, RawItem } from './index.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  'content:encoded'?: string;
  pubDate?: string;
  guid?: string | { '#text': string };
}

interface AtomEntry {
  title?: string | { '#text': string };
  link?: { '@_href': string } | string;
  content?: string;
  summary?: string;
  published?: string;
  updated?: string;
  id?: string;
}

export class RssAdapter implements SourceAdapter {
  readonly source = 'rss' as const;

  async fetch(config: AdapterConfig, since?: Date): Promise<FetchResult> {
    const feedUrl = config.credentials?.['feedUrl'];
    if (!feedUrl) throw new Error('feedUrl required in credentials');

    const res = await fetch(feedUrl, {
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} for ${feedUrl}`);

    const xml = await res.text();
    const parsed = parser.parse(xml) as Record<string, unknown>;
    let items = extractItems(parsed);
    if (since) items = items.filter((item) => item.publishedAt > since);

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

function extractItems(parsed: Record<string, unknown>): RawItem[] {
  const rss = parsed['rss'] as Record<string, unknown> | undefined;
  if (rss) {
    const channel = rss['channel'] as Record<string, unknown> | undefined;
    return toArray<RssItem>(channel?.['item']).map(fromRssItem).filter((i) => i.text);
  }

  const feed = parsed['feed'] as Record<string, unknown> | undefined;
  if (feed) {
    return toArray<AtomEntry>(feed['entry']).map(fromAtomEntry).filter((i) => i.text);
  }

  return [];
}

function fromRssItem(item: RssItem): RawItem {
  const guid = typeof item.guid === 'object' ? item.guid['#text'] : item.guid;
  return {
    externalId: guid ?? item.link ?? '',
    url: item.link ?? '',
    text: item['content:encoded'] ?? item.description ?? item.title ?? '',
    publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
    metadata: { title: item.title },
  };
}

function fromAtomEntry(entry: AtomEntry): RawItem {
  const title = typeof entry.title === 'object' ? entry.title['#text'] : entry.title;
  const link =
    typeof entry.link === 'object' ? entry.link['@_href'] : (entry.link ?? '');
  return {
    externalId: entry.id ?? link,
    url: link,
    text: entry.content ?? entry.summary ?? title ?? '',
    publishedAt: entry.published
      ? new Date(entry.published)
      : entry.updated
        ? new Date(entry.updated)
        : new Date(),
    metadata: { title },
  };
}

function toArray<T>(value: unknown): T[] {
  if (!value) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}
