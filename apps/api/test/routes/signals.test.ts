import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

let _dbRows: unknown[] = [];
const _dbRowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  [
    'select',
    'from',
    'where',
    'insert',
    'values',
    'update',
    'set',
    'innerJoin',
    'leftJoin',
    'limit',
    'offset',
    'orderBy',
    'onConflictDoUpdate',
    'onConflictDoNothing',
  ].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  const nextRows = () => (_dbRowQueue.length ? _dbRowQueue.shift()! : _dbRows);
  chain['returning'] = vi.fn(() => Promise.resolve(nextRows()));
  chain['then'] = (r: unknown, j?: unknown) =>
    Promise.resolve(nextRows()).then(r as never, j as never);
  chain['transaction'] = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(chain));
  return {
    db: { get: vi.fn(() => chain) },
    /* Real behaviour is covered in `attributed-to.test.ts` against drizzle's dialect; these
       tests assert response shape, so the predicate only has to be callable. */
    attributedTo: vi.fn(() => ({ _attributedTo: true })),
    tenants: {},
    brandEntities: {},
    signals: {},
    users: {},
    sentimentResults: {},
    dimensionScores: {},
    sourceConfigs: {},
    client: { get: vi.fn() },
  };
});

import signalsRoutes from '../../src/routes/signals.js';

const now = new Date();
const signal = (id: string) => ({
  id,
  tenantId: 'tenant-1',
  brandEntityId: 'brand-1',
  source: 'google_reviews',
  sourceUrl: 'https://maps.google.com/review/1',
  rawStorageRef: 's3://bucket/1',
  publishedAt: now,
  ingestedAt: now,
});

beforeEach(() => {
  _dbRows = [];
  _dbRowQueue.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands/:id/signals', () => {
  it('returns signals for a brand', async () => {
    _dbRows = [signal('s1'), signal('s2')];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeNull();
  });

  // The response schema declared `items: { type: 'object' }` with no properties, and
  // fast-json-stringify strips everything undeclared — so this endpoint returned
  // `items: [{}, {}]` for its entire life. Assert the payload actually carries fields.
  it('serialises signal fields rather than empty objects', async () => {
    _dbRows = [signal('s1')];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });

    const [item] = JSON.parse(res.body).items;
    expect(item).toMatchObject({
      id: 's1',
      tenantId: 'tenant-1',
      brandEntityId: 'brand-1',
      source: 'google_reviews',
      sourceUrl: 'https://maps.google.com/review/1',
      rawStorageRef: 's3://bucket/1',
    });
    expect(item.publishedAt).toBe(now.toISOString());
  });

  it('paginates: returns nextCursor when more items exist than limit', async () => {
    // Return limit+1 items to trigger pagination
    const items = Array.from({ length: 51 }, (_, i) => signal(`s${i}`));
    _dbRows = items;
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals?limit=50' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(50);
    expect(body.nextCursor).not.toBeNull();
  });

  it('returns empty items when brand has no signals', async () => {
    _dbRows = [];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ items: [], nextCursor: null });
  });

  // KNOWN-GAPS #6 — without a deterministic ORDER BY, keyset pagination over a random
  // UUID can repeat rows, skip rows, or terminate early.
  it('orders by published_at then id so the keyset is deterministic', async () => {
    _dbRows = [signal('s1')];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });

    const { db } = await import('@project-signal/db');
    expect(
      (db.get() as unknown as { orderBy: ReturnType<typeof vi.fn> }).orderBy,
    ).toHaveBeenCalledOnce();
  });

  it('returns a composite cursor encoding both publishedAt and id', async () => {
    const items = Array.from({ length: 51 }, (_, i) => signal(`s${i}`));
    _dbRows = items;
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals?limit=50' });

    const { nextCursor } = JSON.parse(res.body);
    const decoded = Buffer.from(nextCursor, 'base64url').toString('utf8');
    expect(decoded).toBe(`${now.toISOString()}|s49`);
  });

  it('rejects a malformed cursor rather than silently returning the first page', async () => {
    _dbRows = [signal('s1')];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/brand-1/signals?cursor=not-a-real-cursor',
    });
    expect(res.statusCode).toBe(400);
  });
});

// KNOWN-GAPS #5 — cross-tenant isolation held, but a `user` pinned to brand A could read
// brand B's data inside the same tenant by changing the URL.
describe('brand-scoped authorisation', () => {
  const routes = ['signals', 'sentiment-summary'] as const;

  for (const route of routes) {
    it(`allows a pinned user to read their own brand's ${route}`, async () => {
      _dbRows =
        route === 'sentiment-summary'
          ? [
              {
                totalCount: '0',
                avgScore: null,
                positiveCount: '0',
                negativeCount: '0',
                neutralCount: '0',
                mixedCount: '0',
              },
            ]
          : [];
      const app = await buildTestApp(signalsRoutes, DEFAULT_PINNED_USER);
      const res = await app.inject({ method: 'GET', url: `/brands/brand-1/${route}` });
      expect(res.statusCode).toBe(200);
    });

    it(`forbids a pinned user from reading another brand's ${route}`, async () => {
      _dbRows = [];
      const app = await buildTestApp(signalsRoutes, DEFAULT_PINNED_USER);
      const res = await app.inject({ method: 'GET', url: `/brands/brand-2/${route}` });
      expect(res.statusCode).toBe(403);
    });

    it(`allows an admin to read any brand's ${route} within the tenant`, async () => {
      _dbRows =
        route === 'sentiment-summary'
          ? [
              {
                totalCount: '0',
                avgScore: null,
                positiveCount: '0',
                negativeCount: '0',
                neutralCount: '0',
                mixedCount: '0',
              },
            ]
          : [];
      const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
      const res = await app.inject({ method: 'GET', url: `/brands/brand-2/${route}` });
      expect(res.statusCode).toBe(200);
    });
  }
});

describe('GET /brands/:id/sentiment-summary', () => {
  it('returns aggregated sentiment data for last 30 days', async () => {
    _dbRows = [
      {
        totalCount: '10',
        avgScore: '0.75',
        positiveCount: '7',
        negativeCount: '1',
        neutralCount: '1',
        mixedCount: '1',
      },
    ];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/sentiment-summary' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalCount).toBe(10);
    expect(body.positiveCount).toBe(7);
    expect(body.avgScore).toBeCloseTo(0.75);
    expect(body.period).toBe('30d');
  });

  it('returns zero counts and null avgScore when no data', async () => {
    _dbRows = [
      {
        totalCount: '0',
        avgScore: null,
        positiveCount: '0',
        negativeCount: '0',
        neutralCount: '0',
        mixedCount: '0',
      },
    ];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/sentiment-summary' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalCount).toBe(0);
    expect(body.avgScore).toBeNull();
  });
});

/**
 * The readable evidence.
 *
 * WHY THIS EXISTS. The verbatim text of every signal was written to S3 and then unreachable:
 * `signals` held only a storage pointer, no endpoint read it back, and so the drill-down could
 * show a source name, a date and a link out — nothing a person could read. Working through one
 * dimension meant opening every signal in a new tab and correlating by hand.
 *
 * The endpoint now returns the words, who said them, their rating, AND the scorer's verdict, so
 * the UI never has to send a marketing manager elsewhere to find out what was said. `sourceUrl`
 * is still returned and still rendered: the link to the original is an ADDITION, never a
 * substitute.
 */
describe('the evidence a signal carries', () => {
  const scored = {
    ...signal('s-1'),
    content: 'Constant crashes\n\nIt closes whenever I open a class.',
    title: 'Constant crashes',
    author: 'e_keane',
    rating: 2,
    label: 'negative',
    score: -0.8,
    confidence: 0.9,
    dimensions: ['quality'],
    topics: ['app stability'],
  };

  it('returns the text, the author and the rating', async () => {
    _dbRows = [scored];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });

    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({
      content: 'Constant crashes\n\nIt closes whenever I open a class.',
      title: 'Constant crashes',
      author: 'e_keane',
      rating: 2,
    });
  });

  it('still returns the link to the original alongside the text', async () => {
    /* Explicitly pinned. The point of storing the text was never to remove the route back to the
       source — a manager reads it here, then follows the link to reply or see context. */
    _dbRows = [scored];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });

    expect(res.json().items[0].sourceUrl).toBe('https://maps.google.com/review/1');
  });

  it("nests the scorer's verdict rather than flattening it onto the signal", async () => {
    /* A quotation with no verdict attached moves the guessing game rather than ending it: the
       audience is a marketing manager, who needs to see how the system read the words. Nested so
       "what was said" stays distinguishable from "what we concluded". */
    _dbRows = [scored];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });

    expect(res.json().items[0].sentiment).toEqual({
      label: 'negative',
      score: -0.8,
      confidence: 0.9,
      dimensions: ['quality'],
      topics: ['app stability'],
    });
  });

  it('reports an unscored signal as sentiment: null, and still returns it', async () => {
    /* A LEFT join deliberately. An unscored signal is still evidence — dropping it would make
       the list disagree with the counts shown above it. Null is distinct from a neutral score,
       and the UI renders the two differently. */
    _dbRows = [{ ...signal('s-2'), content: 'Not yet scored', label: null }];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });

    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].sentiment).toBeNull();
    expect(res.json().items[0].content).toBe('Not yet scored');
  });

  it('returns null content for a signal collected before text was captured', async () => {
    /* 383 rows are in this state until the backfill has run over them. Null must reach the UI so
       it can say "not yet recovered" rather than implying the source said nothing. */
    _dbRows = [{ ...signal('s-3'), content: null }];
    const app = await buildTestApp(signalsRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });

    expect(res.json().items[0].content).toBeNull();
  });
});
