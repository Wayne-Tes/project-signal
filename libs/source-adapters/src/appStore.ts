import { XMLParser } from 'fast-xml-parser';
import type { Signal } from '@project-signal/shared-types';
import type { SourceAdapter, AdapterConfig, FetchResult, RawItem } from './index.js';

/**
 * App Store reviews, from Apple's own public feed.
 *
 * NO APIFY, NO KEY, NO COST. Apple publishes customer reviews as an Atom feed at
 * `itunes.apple.com/<country>/rss/customerreviews/id=<appId>/sortby=mostrecent/xml`, and it
 * returns fifty reviews per page for free. Verified against `id=1018656220` (ClassCharts
 * Students, GB) on 2026-08-10: **HTTP 200, 50 entries**, with title, body, rating, author and
 * version on each.
 *
 * This adapter previously drove `nikita-shakula~app-store-scraper` through Apify. That actor
 * **no longer exists** — `GET /v2/acts/nikita-shakula~app-store-scraper` returns 404 — so the
 * source could not have worked whatever credential was configured. Two replacements from the
 * store were tried before this route was taken; `thewolves~appstore-reviews-scraper` and
 * `easyapi~app-store-reviews-scraper` both ran to SUCCEEDED and returned `noResults` for a real
 * app with 2,490 ratings.
 *
 * The schema comment in `libs/db/src/schema/sourceConfigs.ts` has said `app_store: RSS feed, no
 * auth needed` since the table was written. The intent was always this; the implementation had
 * drifted to a paid scraper that then rotted.
 */

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** Apple's default store. Overridden per feed — each territory is a different review population. */
const DEFAULT_COUNTRY = 'us';

/**
 * What people type, mapped to what Apple accepts.
 *
 * Apple uses ISO 3166-1 alpha-2, where the United Kingdom is **`gb`**. "UK" is not in that
 * standard, and it is the first thing a British user types — this tenant's own App Store feed was
 * configured as `UK` and returned `400` for it. A 400 from a store URL is indistinguishable from
 * a wrong app id to anyone reading the error, so guessing correctly here saves a support round
 * trip rather than papering over one.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'gb',
  en: 'gb',
  eng: 'gb',
  gbr: 'gb',
  usa: 'us',
  uae: 'ae',
};

/** One `<entry>` from the feed. Every entry is a customer review; the feed's own metadata sits
    outside `<entry>` and never reaches here. */
interface AppleEntry {
  id?: string | { '#text'?: string };
  title?: string;
  content?: string | { '#text'?: string; '@_type'?: string } | (string | object)[];
  updated?: string;
  author?: { name?: string; uri?: string };
  link?: { '@_href'?: string } | { '@_href'?: string }[];
  'im:rating'?: string | number;
  'im:version'?: string | number;
  'im:voteSum'?: string | number;
  'im:voteCount'?: string | number;
}

export class AppStoreAdapter implements SourceAdapter {
  readonly source = 'app_store' as const;

  async fetch(config: AdapterConfig, since?: Date): Promise<FetchResult> {
    const appId = config.credentials?.['appId'];
    if (!appId) throw new Error('appId required in credentials');

    /* Lower-cased and stripped of anything that is not a letter: the field is free text and "GB"
       or "gb " both arrive from a form, while Apple's path segment is case-sensitive. */
    const typed = (config.credentials?.['country'] ?? DEFAULT_COUNTRY)
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    /* Parenthesised deliberately: `??` and `||` cannot be mixed without them, and the two do
       different jobs here — the alias if there is one, otherwise what was typed, and the default
       only when that leaves nothing at all. */
    const country = (COUNTRY_ALIASES[typed] ?? typed) || DEFAULT_COUNTRY;

    /* A bare numeric id. A pasted store URL is the single most likely input error, so the digits
       are extracted rather than the request being sent to a URL that will 404. */
    const numericId = /^\d+$/.test(appId) ? appId : (appId.match(/id(\d+)/)?.[1] ?? appId);

    const url = `https://itunes.apple.com/${country}/rss/customerreviews/id=${numericId}/sortby=mostrecent/xml`;

    const res = await fetch(url, { headers: { Accept: 'application/atom+xml, application/xml' } });
    if (!res.ok) {
      /* The status is in the message. A 404 means the app id or country is wrong — which the
         person who configured the feed can fix — and that is a different conversation from a
         503. */
      throw new Error(`App Store feed failed: ${res.status} for app ${numericId} (${country})`);
    }

    const parsed = parser.parse(await res.text()) as Record<string, unknown>;
    const feed = parsed['feed'] as Record<string, unknown> | undefined;
    let items = toArray<AppleEntry>(feed?.['entry'])
      .map(toRawItem)
      /* A rating is what makes an entry a review. Verified across two real feeds that every
         `<entry>` is one and carries `im:rating` — the feed's own `<id>`, which is the feed URL,
         is a sibling of `<entry>` rather than an entry, so it never appears here. The filter is
         kept as a guard rather than a fix: an entry with no rating is not a customer review, and
         storing one would put Apple's own boilerplate into the index as a signal. */
      .filter((item) => item.text.length > 0 && item.metadata['rating'] !== undefined);

    if (since) items = items.filter((item) => item.publishedAt > since);

    return { items };
  }

  toSignal(
    item: RawItem,
    config: AdapterConfig,
  ): Omit<Signal, 'id' | 'ingestedAt' | 'rawStorageRef'> {
    return {
      tenantId: config.tenantId,
      brandEntityId: config.brandEntityId,
      source: this.source,
      sourceUrl: item.url,
      publishedAt: item.publishedAt,
    };
  }
}

function toRawItem(entry: AppleEntry): RawItem {
  const id = typeof entry.id === 'object' ? (entry.id?.['#text'] ?? '') : (entry.id ?? '');
  const body = contentText(entry.content);
  const rating = numberOrUndefined(entry['im:rating']);

  return {
    externalId: String(id),
    url: hrefOf(entry.link),
    /* Title AND body. An App Store review's title carries most of the sentiment — "Constant
       crashes" over three paragraphs of detail — and scoring only the body would discard it. */
    text: [entry.title, body].filter(Boolean).join('\n\n').trim(),
    publishedAt: entry.updated ? new Date(entry.updated) : new Date(),
    metadata: {
      rating,
      author: entry.author?.name,
      version: entry['im:version'],
      helpful: numberOrUndefined(entry['im:voteSum']),
    },
  };
}

/**
 * The review text.
 *
 * `content` arrives as a string, as an object with `#text`, or as an ARRAY of both when Apple
 * sends the plain-text and HTML variants together. The array case is the normal one for reviews,
 * and reading it as a string yields `[object Object]` as the signal body.
 */
function contentText(content: AppleEntry['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      const text = contentText(part as AppleEntry['content']);
      if (text) return text;
    }
    return '';
  }
  if (content && typeof content === 'object') return String(content['#text'] ?? '');
  return '';
}

function hrefOf(link: AppleEntry['link']): string {
  if (Array.isArray(link)) return link[0]?.['@_href'] ?? '';
  return link?.['@_href'] ?? '';
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

function toArray<T>(value: unknown): T[] {
  if (!value) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}
