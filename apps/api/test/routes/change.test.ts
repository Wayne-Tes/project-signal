import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type * as DbModule from '@project-signal/db';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

let _rows: unknown[] = [];
const _queue: unknown[][] = [];
const _executed: unknown[] = [];

vi.mock('@project-signal/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  const chain: Record<string, unknown> = {};
  ['select', 'from', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'limit'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  const next = () => (_queue.length ? _queue.shift()! : _rows);
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(next()).then(r as never, j as never);
  /* The first-seen read is raw SQL. Capturing it rather than stubbing it away is the point:
     the fragment it produces is asserted below through drizzle's real dialect. */
  chain['execute'] = vi.fn((query: unknown) => {
    _executed.push(query);
    return Promise.resolve(_queue.length ? _queue.shift()! : []);
  });
  return {
    ...actual,
    db: { get: vi.fn(() => chain) },
  };
});

import changeRoutes from '../../src/routes/change.js';

const DAY = 24 * 60 * 60 * 1000;

const signal = (over: Record<string, unknown> = {}) => {
  const at = new Date(Date.now() - DAY);
  return {
    signalId: 'sig-1',
    publishedAt: at,
    ingestedAt: at,
    source: 'rss',
    score: -0.4,
    label: 'negative',
    topics: ['pricing'],
    ...over,
  };
};

beforeEach(() => {
  _rows = [];
  _queue.length = 0;
  _executed.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands/:id/whats-new', () => {
  it('summarises the window and echoes the basis back', async () => {
    _queue.push([signal()]); // the window read
    _queue.push([]); // first-seen read
    const app = await buildTestApp(changeRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/whats-new' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    /* Echoed so the UI can label which question it is answering. A surface showing "new this
       week" on a publication basis, or trend on an ingestion basis, is a surface that lies. */
    expect(body.basis).toBe('ingested');
    expect(body.signalsThisPeriod).toBe(1);
    expect(body.newTopics.map((t: { topic: string }) => t.topic)).toEqual(['pricing']);
  });

  it('reports a null sentiment delta rather than zero when there is no prior period', async () => {
    _queue.push([signal()]);
    _queue.push([]);
    const app = await buildTestApp(changeRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/whats-new' });

    /* `▲ +0` against a comparison point that never existed is a defect this codebase has already
       shipped once, on the dimension bars. `nullable: true` in the response schema is what lets
       the null survive fast-json-stringify — without it the field is stripped and the UI sees
       `undefined`, which it renders as zero. */
    expect(JSON.parse(res.body).sentimentDelta).toBeNull();
  });

  it('accepts an explicit window and basis', async () => {
    _queue.push([]);
    _queue.push([]);
    const app = await buildTestApp(changeRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'GET',
      url: '/brands/brand-1/whats-new?days=30&basis=published',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).basis).toBe('published');
  });

  it('refuses a window longer than the maximum', async () => {
    const app = await buildTestApp(changeRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/whats-new?days=400' });
    expect(res.statusCode).toBe(400);
  });

  it('refuses an unrecognised basis rather than silently defaulting', async () => {
    const app = await buildTestApp(changeRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/whats-new?basis=guessed' });
    expect(res.statusCode).toBe(400);
  });

  /**
   * Tenant scoping is opt-in in this product and nothing fails when a new route omits it — that
   * is how `GET /brands/:id` kept an intra-tenant hole and how the content backfill route shipped
   * reading every tenant's signals. Every new brand-scoped route gets this test.
   */
  it('is brand-scoped', async () => {
    const app = await buildTestApp(changeRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/whats-new' });
    expect(res.statusCode).toBe(403);
  });
});

/**
 * The first-seen query is raw SQL, so a mocked database proves nothing about it — the same blind
 * spot that let two `Date`-serialisation defects reach runtime. Rendered through drizzle's real
 * dialect here; separately executed against real Postgres during development, which confirmed the
 * lateral unnest, the topic normalisation and the tenant filter all behave.
 */
describe('the first-seen query', () => {
  const dialect = new PgDialect();

  async function renderFirstSeen(url = '/brands/brand-1/whats-new'): Promise<string> {
    _queue.push([]);
    _queue.push([]);
    const app = await buildTestApp(changeRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'GET', url });
    expect(_executed.length, 'the first-seen query was never issued').toBeGreaterThan(0);
    return dialect.sqlToQuery(_executed[0] as never).sql.toLowerCase();
  }

  it('unnests the topic array rather than reading every signal into the app', async () => {
    const sql = await renderFirstSeen();
    expect(sql).toContain('unnest');
    expect(sql).toContain('lateral');
    expect(sql).toContain('min(');
    expect(sql).toContain('group by');
  });

  it('normalises the topic in the database the same way the app does', async () => {
    /* `lower(btrim(...))` matches `normaliseTopic` in libs/scoring. If the two disagree, a topic
       first seen months ago fails to match its own current spelling and is reported as NEW —
       which is the one claim this endpoint exists to make correctly. */
    const sql = await renderFirstSeen();
    expect(sql).toContain('lower(btrim(');
  });

  it('carries the tenant filter into the raw query', async () => {
    const sql = await renderFirstSeen();
    expect((sql.match(/tenant_id/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('reads the publication date when the basis is published', async () => {
    const sql = await renderFirstSeen('/brands/brand-1/whats-new?basis=published');
    expect(sql).toContain('published_at');
  });

  it('reads the ingestion date when the basis is ingested', async () => {
    const sql = await renderFirstSeen('/brands/brand-1/whats-new?basis=ingested');
    expect(sql).toContain('ingested_at');
  });

  /**
   * Deliberately unbounded in time, unlike every other read.
   *
   * "New" is a claim about all of history. Bounding this to the rollup's 360-day window would
   * quietly convert it into "not seen recently", and a topic returning after a year would be
   * announced as new — sending whoever acts on it hunting a cause that does not exist.
   */
  it('does not bound the first sighting to a recent window', async () => {
    const sql = await renderFirstSeen();
    expect(sql).not.toContain('>=');
  });
});
