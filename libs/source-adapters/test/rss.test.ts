import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RssAdapter } from '../src/rss.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const adapter = new RssAdapter();

const config = {
  brandEntityId: 'brand-1',
  tenantId: 'tenant-1',
  source: 'rss' as const,
  credentials: { feedUrl: 'https://example.com/feed.xml' },
};

const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <guid>item-1</guid>
      <link>https://example.com/post/1</link>
      <title>First Post</title>
      <description>This is the first post description</description>
      <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    </item>
    <item>
      <guid>item-2</guid>
      <link>https://example.com/post/2</link>
      <title>Second Post</title>
      <description>Second post body text</description>
      <pubDate>Tue, 02 Jan 2024 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_XML = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>atom-entry-1</id>
    <title>Atom Title</title>
    <link href="https://example.com/atom/1"/>
    <content>Atom entry content here</content>
    <published>2024-02-01T10:00:00Z</published>
  </entry>
</feed>`;

function xmlResponse(xml: string) {
  return { ok: true, status: 200, text: () => Promise.resolve(xml) };
}

describe('RssAdapter', () => {
  it('source is rss', () => {
    expect(adapter.source).toBe('rss');
  });

  it('parses RSS 2.0 feed and returns items', async () => {
    mockFetch.mockResolvedValue(xmlResponse(RSS_XML));
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(2);
    expect(items[0]?.url).toBe('https://example.com/post/1');
    expect(items[0]?.text).toContain('first post description');
  });

  it('parses Atom feed and returns items', async () => {
    mockFetch.mockResolvedValue(xmlResponse(ATOM_XML));
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain('Atom entry content');
    expect(items[0]?.url).toBe('https://example.com/atom/1');
  });

  it('filters items published before the since date', async () => {
    mockFetch.mockResolvedValue(xmlResponse(RSS_XML));
    const since = new Date('2024-01-01T12:00:00Z');
    const { items } = await adapter.fetch(config, since);
    // Only second item (Jan 2) is after since date (Jan 1 noon)
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://example.com/post/2');
  });

  it('throws when feedUrl is missing from credentials', async () => {
    await expect(adapter.fetch({ ...config, credentials: {} })).rejects.toThrow('feedUrl');
  });

  it('throws when fetch returns non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') });
    await expect(adapter.fetch(config)).rejects.toThrow('404');
  });

  it('toSignal maps item to signal shape', () => {
    const item = { externalId: 'i1', url: 'https://example.com/p/1', text: 'content', publishedAt: new Date(), metadata: {} };
    const signal = adapter.toSignal(item, config);
    expect(signal.source).toBe('rss');
    expect(signal.tenantId).toBe('tenant-1');
    expect(signal.brandEntityId).toBe('brand-1');
    expect(signal.sourceUrl).toBe(item.url);
  });

  it('returns empty array for XML with neither rss nor feed root', async () => {
    mockFetch.mockResolvedValue(xmlResponse('<?xml version="1.0"?><unknown></unknown>'));
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(0);
  });

  it('handles RSS item with object guid, content:encoded, and missing link', async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <guid isPermaLink="false">guid-obj</guid>
      <content:encoded>Full encoded body</content:encoded>
      <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    </item></channel></rss>`;
    mockFetch.mockResolvedValue(xmlResponse(xml));
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
    expect(items[0]?.externalId).toBe('guid-obj');
    expect(items[0]?.url).toBe('');
    expect(items[0]?.text).toBe('Full encoded body');
  });

  it('handles Atom entry with object title, summary fallback, and updated date', async () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <id>atom-2</id>
      <title type="text">Object Title</title>
      <link href="https://example.com/atom/2"/>
      <summary>Summary fallback text</summary>
      <updated>2024-03-01T10:00:00Z</updated>
    </entry></feed>`;
    mockFetch.mockResolvedValue(xmlResponse(xml));
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
    /* The headline is now KEPT rather than discarded. This test previously asserted
       `'Summary fallback text'` — the body alone — which is what the adapter used to produce, and
       it meant the title was thrown away on every news item. For a news article the headline is
       the substance, and it is what a marketing manager reads first in the drill-down. */
    expect(items[0]?.text).toBe('Object Title\n\nSummary fallback text');
    expect(items[0]?.title).toBe('Object Title');
    expect(items[0]?.publishedAt.toISOString()).toBe('2024-03-01T10:00:00.000Z');
  });

  it('handles Atom entry with string link, title fallback, and no date', async () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <title>Title Only</title>
      <link>https://example.com/atom/3</link>
    </entry></feed>`;
    mockFetch.mockResolvedValue(xmlResponse(xml));
    const before = Date.now();
    const { items } = await adapter.fetch(config);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://example.com/atom/3');
    expect(items[0]?.text).toBe('Title Only');
    expect(items[0]?.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

/**
 * The Google News payload, which is 225 of this tenant's 228 signals.
 *
 * Its `<description>` is not a description. It is an anchor element wrapping the headline, with a
 * tracking URL several times longer than the sentence, plus a grey `<font>` tag naming the
 * publication. That string went straight to the sentiment scorer — so trust, quality and
 * experience scores were partly assigned to HTML — and it is now rendered to a marketing manager
 * in the drill-down, where a raw tag would be plainly broken.
 */
describe('the real Google News shape', () => {
  const GOOGLE_NEWS = `<?xml version="1.0"?><rss version="2.0"><channel><item>
    <title>A better way to help pupils engage with global crises</title>
    <link>https://news.google.com/rss/articles/CBMiqgFBVV95cUxQ?oc=5</link>
    <guid isPermaLink="false">CBMiqgFBVV95cUxQ</guid>
    <pubDate>Sun, 27 Jul 2026 05:00:00 GMT</pubDate>
    <description>&lt;a href="https://news.google.com/rss/articles/CBMiqgFBVV95cUxQM2dBRmR1VE9KLU5IRkoyQWJFWEtCWE80ZXRfYVBQZU82YVBTb0xCUmRjMEdPYktzV21oRw?oc=5" target="_blank"&gt;A better way to help pupils engage with global crises&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Tes&lt;/font&gt;</description>
  </item></channel></rss>`;

  it('stores the headline, not an anchor tag', async () => {
    mockFetch.mockResolvedValue(xmlResponse(GOOGLE_NEWS));
    const { items } = await adapter.fetch(config);

    expect(items[0]?.text).toContain('A better way to help pupils engage with global crises');
    expect(items[0]?.text).not.toContain('<a');
    expect(items[0]?.text).not.toContain('href');
    expect(items[0]?.text).not.toContain('news.google.com');
  });

  it('does not repeat the headline twice', async () => {
    /* Title and description are the SAME sentence here. Naively joining them would render the
       headline twice in the UI and double its weight to the scorer. */
    mockFetch.mockResolvedValue(xmlResponse(GOOGLE_NEWS));
    const { items } = await adapter.fetch(config);

    const occurrences = items[0]!.text.split('A better way to help pupils').length - 1;
    expect(occurrences).toBe(1);
  });

  it('exposes the headline separately so the UI can lead with it', async () => {
    mockFetch.mockResolvedValue(xmlResponse(GOOGLE_NEWS));
    const { items } = await adapter.fetch(config);
    expect(items[0]?.title).toBe('A better way to help pupils engage with global crises');
  });

  it('has no author, and says so rather than inventing one', async () => {
    /* An RSS item genuinely has no author. Undefined is rendered as absent by the UI, which is
       different from an empty string or a placeholder name. */
    mockFetch.mockResolvedValue(xmlResponse(GOOGLE_NEWS));
    const { items } = await adapter.fetch(config);
    expect(items[0]?.author).toBeUndefined();
    expect(items[0]?.rating).toBeUndefined();
  });
});
