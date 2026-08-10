import type { Signal } from '@project-signal/shared-types';
import { startApifyRun, waitForApifyRun, fetchApifyDataset } from './apifyClient.js';
import type { SourceAdapter, AdapterConfig, FetchResult, RawItem } from './index.js';
import { clampContent, joinTitleAndBody, stripHtml } from './text.js';

/**
 * Reddit, via Apify.
 *
 * Reddit is where an education brand is discussed unprompted and at length — teachers in
 * r/TeachingUK arguing about a safeguarding tool, parents in r/AskUK about a school app. Every
 * other adapter here reads somewhere the brand controls or invites comment on. This one reads
 * conversation the brand is not part of, which is exactly why it is worth having.
 *
 * **Through Apify rather than Reddit's own API**, matching `googleReviews`, `appStore` and
 * `playStore`. The account and key already exist and are already wired through
 * `getSystemCredentials`, so there is no second credential to provision, no OAuth app to
 * register, and no separate rate-limit budget to reason about. Reddit's public JSON endpoint
 * would also work today and needs no key at all, but it answers an unidentified or
 * datacentre-hosted client with 429 — which from inside a Fargate task presents as an
 * intermittent, unexplained failure. Apify's residential proxy is the thing being paid for.
 *
 * ACTOR AND FIELD NAMES ARE VERIFIED, NOT REMEMBERED. `trudax/reddit-scraper-lite`, actor id
 * `oAuCIx3ItNrs2okjQ`, build 5.7.9; the input schema was read from
 * `GET /v2/actor-builds/{id}` and the output shape below was taken from two real runs against
 * this account on 2026-08-09 — `id, parsedId, url, username, title, communityName,
 * parsedCommunityName, body, html, createdAt, scrapedAt, dataType`. This repository has twice
 * shipped a model id written from memory; an actor id and a field name decay the same way.
 */

/** `trudax/reddit-scraper-lite`. The tilde form is what the Apify REST API expects in a path. */
const ACTOR_ID = 'trudax~reddit-scraper-lite';

/** Per run. High enough to catch a busy week, low enough that one feed cannot run away. */
const DEFAULT_MAX_ITEMS = 50;

/** Apify's own ceiling for a sensible single run here; a larger ask costs more and returns late. */
const MAX_ITEMS_CAP = 200;

/**
 * One row of the actor's dataset.
 *
 * Every field is optional because they are observed, not contractual: an actor build can drop a
 * field without warning, and the failure mode of assuming otherwise is a crash inside a
 * collection run that the dispatcher records as "source failed" with no explanation.
 */
interface ApifyRedditItem {
  /** Reddit fullname, e.g. `t3_1u43jul` — unique across the whole site. */
  id?: string;
  parsedId?: string;
  url?: string;
  username?: string;
  title?: string;
  /** `r/TeachingUK`. `parsedCommunityName` is the same without the prefix. */
  communityName?: string;
  parsedCommunityName?: string;
  body?: string;
  html?: string;
  /** ISO 8601, UTC. */
  createdAt?: string;
  scrapedAt?: string;
  /** `post` or `comment`. Only posts are requested, but the field is checked rather than assumed. */
  dataType?: string;
  upVotes?: number;
  numberOfComments?: number;
}

export class RedditAdapter implements SourceAdapter {
  readonly source = 'reddit' as const;

  async fetch(config: AdapterConfig, since?: Date): Promise<FetchResult> {
    const apiKey = config.credentials?.['apifyApiKey'];
    const query = config.credentials?.['query'];
    if (!apiKey) throw new Error('apifyApiKey required in credentials');
    if (!query) throw new Error('query required in credentials');

    const subreddit = config.credentials?.['subreddit'];
    const maxItems = Math.min(
      Number(config.credentials?.['maxItems'] ?? DEFAULT_MAX_ITEMS) || DEFAULT_MAX_ITEMS,
      MAX_ITEMS_CAP,
    );

    const input: Record<string, unknown> = {
      searches: [query],
      /* Posts only. Comments would multiply volume by an order of magnitude and arrive without
         the context that makes them scoreable — a two-word reply is not a signal. */
      searchPosts: true,
      searchComments: false,
      searchCommunities: false,
      searchUsers: false,
      skipComments: true,
      /* Newest first, so a capped run returns the most recent items rather than an arbitrary
         slice — which is what makes the `since` filter below meaningful. */
      sort: 'new',
      maxItems,
      maxPostCount: maxItems,
    };

    /* Verified against a live run: `searchCommunityName` genuinely restricts results to that
       subreddit — a search for "ofsted" scoped to TeachingUK returned only r/TeachingUK posts.
       Left unset for a site-wide search. */
    if (subreddit) input['searchCommunityName'] = subreddit.replace(/^\/?r\//, '');

    const run = await startApifyRun(apiKey, ACTOR_ID, input);
    const completed = await waitForApifyRun(apiKey, run.id);
    const rows = await fetchApifyDataset<ApifyRedditItem>(apiKey, completed.defaultDatasetId);

    let items = rows
      /* `dataType` is checked rather than trusted. `skipComments` is asked for, but a mixed
         dataset would otherwise be turned into signals whose text is a one-line reply. */
      .filter((row) => (row.dataType ?? 'post') === 'post')
      .map(toRawItem)
      .filter((item) => item.text.length > 0 && item.externalId.length > 0);

    /* Filtered here rather than through the actor's `postDateLimit`. The date format that input
       expects is not documented in its schema, and a cutoff silently rejected by the actor would
       return everything on every run — expensive, and invisible, because the result still looks
       like a successful collection. Comparing dates locally cannot fail that way. */
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

function toRawItem(row: ApifyRedditItem): RawItem {
  /* Title AND body. A Reddit post is very often a title alone — "Anyone else having problems with
     MyConcern today?" — and a post with an empty body is the norm, not the exception. Scoring
     only the body would discard the entire signal in the most common case. */
  const title = row.title ? stripHtml(String(row.title)) : undefined;
  const text = clampContent(joinTitleAndBody(title, stripHtml(String(row.body ?? ''))));

  return {
    title,
    author: row.username,
    /* The fullname (`t3_…`), which is unique across all of Reddit. `parsedId` is unique only
       within a type, so a post and a comment could collide on it. */
    externalId: row.id ?? row.parsedId ?? '',
    url: row.url ?? '',
    text,
    publishedAt: row.createdAt ? new Date(row.createdAt) : new Date(),
    metadata: {
      title: row.title,
      community: row.parsedCommunityName ?? row.communityName,
      author: row.username,
      upVotes: row.upVotes,
      comments: row.numberOfComments,
    },
  };
}
