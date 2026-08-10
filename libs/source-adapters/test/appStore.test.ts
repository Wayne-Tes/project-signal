import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStoreAdapter } from '../src/appStore.js';

/**
 * App Store reviews, from Apple's own public feed.
 *
 * THIS ADAPTER USED TO GO THROUGH APIFY, AND COULD NOT HAVE WORKED. It drove
 * `nikita-shakula~app-store-scraper`, which no longer exists — `GET /v2/acts/…` returns 404. Two
 * replacements from the Apify store were tried before this route was taken; both ran to SUCCEEDED
 * and returned `noResults` for an app with 2,490 ratings. One of those two turned out to be
 * refused by the Apify FREE plan rather than broken — see the corrected note in `src/appStore.ts`
 * and `docs/OWNER-ACTIONS.md` §4b, because `noResults` on a SUCCEEDED run means "quota or plan",
 * not "dead", and reading it as the latter wrote off a working actor.
 *
 * Apple publishes the reviews itself, as an Atom feed, free and unauthenticated — which is what
 * `sourceConfigs.ts` has claimed in a comment since the table was written (`app_store: RSS feed,
 * no auth needed`). The implementation had drifted to a paid scraper that then rotted.
 *
 * THE FIXTURE IS REAL. It is the response from
 * `itunes.apple.com/gb/rss/customerreviews/id=6743850634/…` on 2026-08-10, trimmed to two
 * entries — the nested `content` array, the `im:` prefixes and the attribute shapes are what
 * Apple actually sends, not what its documentation implies.
 */

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:im="http://itunes.apple.com/rss">
  <id>https://itunes.apple.com/gb/rss/customerreviews/id=6743850634/sortby=mostrecent/xml</id>
  <title>iTunes Store: Customer Reviews</title>
  <updated>2026-08-10T04:19:16-07:00</updated>
  <entry>
    <id>14341672833</id>
    <title>TES-YES!</title>
    <content type="text">An exceptionally well-written magazine for educational professionals.</content>
    <content type="html">&lt;p&gt;ignored&lt;/p&gt;</content>
    <im:voteSum>4</im:voteSum>
    <im:voteCount>6</im:voteCount>
    <im:rating>5</im:rating>
    <updated>2026-07-24T01:46:25-07:00</updated>
    <im:version>1.1.13</im:version>
    <author><name>Jo Pro 1606</name><uri>https://itunes.apple.com/gb/reviews/id740</uri></author>
    <link rel="related" href="https://itunes.apple.com/gb/review?id=6743850634&amp;type=Purple"/>
  </entry>
  <entry>
    <id>14196229875</id>
    <title>one annoying bug</title>
    <content type="text">there is one annoying bug which makes me switch to the website</content>
    <im:voteSum>0</im:voteSum>
    <im:voteCount>0</im:voteCount>
    <im:rating>3</im:rating>
    <updated>2026-06-17T23:06:06-07:00</updated>
    <im:version>1.1.13</im:version>
    <author><name>e_keane</name></author>
    <link rel="related" href="https://itunes.apple.com/gb/review?id=6743850634"/>
  </entry>
</feed>`;

const adapter = new AppStoreAdapter();

const config = {
  brandEntityId: 'brand-1',
  tenantId: 'tenant-1',
  source: 'app_store' as const,
  credentials: { appId: '6743850634', country: 'gb' },
};

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function serve(body: string, ok = true, status = 200) {
  fetchMock.mockResolvedValue({ ok, status, text: async () => body });
}

/** The URL the adapter requested. */
function requested(): string {
  return String(fetchMock.mock.calls[0]?.[0] ?? '');
}

beforeEach(() => {
  fetchMock.mockReset();
  serve(FEED);
});

describe('AppStoreAdapter', () => {
  it('is the app_store source', () => {
    expect(adapter.source).toBe('app_store');
  });

  it('needs no Apify key — Apple publishes this feed openly', async () => {
    /* The whole point of the rewrite. No credential, no cost, no actor to rot. */
    await expect(
      adapter.fetch({ ...config, credentials: { appId: '6743850634' } }),
    ).resolves.toBeDefined();
  });

  it('refuses to run without an app id', async () => {
    await expect(adapter.fetch({ ...config, credentials: {} })).rejects.toThrow(/appId required/);
  });

  it('asks Apple for the right app and store', async () => {
    await adapter.fetch(config);
    expect(requested()).toBe(
      'https://itunes.apple.com/gb/rss/customerreviews/id=6743850634/sortby=mostrecent/xml',
    );
  });

  it('defaults to the US store', async () => {
    await adapter.fetch({ ...config, credentials: { appId: '6743850634' } });
    expect(requested()).toContain('/us/rss/');
  });

  it('normalises a country typed as "GB " by a person', async () => {
    /* The field is free text on a form. Apple's path segment is case-sensitive and a trailing
       space produces a 404 that looks like a wrong app id. */
    await adapter.fetch({ ...config, credentials: { appId: '6743850634', country: 'GB ' } });
    expect(requested()).toContain('/gb/rss/');
  });

  it('accepts a pasted store URL and finds the id inside it', async () => {
    /* The single most likely input error, and one the user cannot debug from a 404. */
    await adapter.fetch({
      ...config,
      credentials: { appId: 'https://apps.apple.com/gb/app/tes-magazine/id6743850634', country: 'gb' },
    });
    expect(requested()).toContain('id=6743850634');
  });

  it('maps a real review', async () => {
    const { items } = await adapter.fetch(config);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      externalId: '14341672833',
      url: 'https://itunes.apple.com/gb/review?id=6743850634&type=Purple',
      publishedAt: new Date('2026-07-24T01:46:25-07:00'),
    });
    expect(items[0]!.metadata).toMatchObject({ rating: 5, author: 'Jo Pro 1606', version: '1.1.13' });
  });

  it('reads the text out of the nested content array', async () => {
    /* `content` arrives as an ARRAY of objects when Apple sends the plain-text and HTML variants
       together, which is the normal case. Treating it as a string yields "[object Object]" as the
       body of the signal — a review that scores as meaningless noise. */
    const { items } = await adapter.fetch(config);
    expect(items[0]!.text).toContain('exceptionally well-written magazine');
    expect(items[0]!.text).not.toContain('[object Object]');
  });

  it('scores the title AND the body', async () => {
    /* An App Store review's title carries most of the sentiment — "Constant crashes" over three
       paragraphs of detail. */
    const { items } = await adapter.fetch(config);
    expect(items[0]!.text).toContain('TES-YES!');
    expect(items[0]!.text).toContain('exceptionally well-written');
  });

  it('drops an entry with no rating', async () => {
    /* An entry without a rating is not a customer review. Storing one would put Apple's own
       boilerplate into the index as a signal. */
    serve(FEED.replace('<im:rating>5</im:rating>', ''));
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
  });

  it('filters out anything older than the watermark', async () => {
    const { items } = await adapter.fetch(config, new Date('2026-07-01T00:00:00Z'));
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe('14341672833');
  });

  it('names the status and the app when Apple refuses', async () => {
    /* A 404 means the app id or country is wrong, which the person who configured the feed can
       fix. That is a different conversation from a 503. */
    serve('', false, 404);
    await expect(adapter.fetch(config)).rejects.toThrow(/404.*6743850634.*gb/s);
  });

  it('returns nothing rather than throwing on an empty feed', async () => {
    serve('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    const { items } = await adapter.fetch(config);
    expect(items).toEqual([]);
  });

  it('produces a signal carrying the tenant and brand', async () => {
    const { items } = await adapter.fetch(config);
    expect(adapter.toSignal(items[0]!, config)).toMatchObject({
      tenantId: 'tenant-1',
      brandEntityId: 'brand-1',
      source: 'app_store',
    });
  });
});

describe('country codes people actually type', () => {
  /**
   * Apple uses ISO 3166-1 alpha-2, where the United Kingdom is `gb`. "UK" is not in that
   * standard, and it is the first thing a British user types — this tenant's own feed was
   * configured as `UK` and Apple answered `400`. A 400 from a store URL is indistinguishable from
   * a wrong app id to anyone reading the error.
   */
  it('maps UK to gb, which is what Apple accepts', async () => {
    await adapter.fetch({ ...config, credentials: { appId: '6743850634', country: 'UK' } });
    expect(requested()).toContain('/gb/rss/');
  });

  it('leaves a valid code alone', async () => {
    await adapter.fetch({ ...config, credentials: { appId: '6743850634', country: 'de' } });
    expect(requested()).toContain('/de/rss/');
  });

  it('falls back to the default when the field is blank', async () => {
    await adapter.fetch({ ...config, credentials: { appId: '6743850634', country: '  ' } });
    expect(requested()).toContain('/us/rss/');
  });
});
