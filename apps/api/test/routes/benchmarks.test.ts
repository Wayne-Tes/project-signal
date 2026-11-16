import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@project-signal/db';

const _queue: unknown[][] = [];
const _where: unknown[] = [];

vi.mock('@project-signal/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'orderBy', 'limit']) chain[m] = vi.fn(() => chain);
  chain['where'] = vi.fn((w: unknown) => {
    _where.push(w);
    return chain;
  });
  chain['then'] = (r: unknown, j?: unknown) =>
    Promise.resolve(_queue.length ? _queue.shift()! : []).then(r as never, j as never);
  return { ...actual, db: { get: vi.fn(() => chain) } };
});

const { readBenchmarks } = await import('../../src/routes/roadmap.js');
const { PgDialect } = await import('drizzle-orm/pg-core');

const TENANT = '11111111-1111-4111-8111-111111111111';
const BRAND = 'b1111111-1111-4111-8111-111111111111';
const dialect = new PgDialect();

/** Every captured WHERE rendered to SQL + params, so the actual predicate can be asserted. */
function renderedWheres(): { sql: string; params: unknown[] }[] {
  return _where.map((w) => dialect.sqlToQuery(w as never));
}

beforeEach(() => {
  _queue.length = 0;
  _where.length = 0;
  vi.clearAllMocks();
});

/**
 * The benchmarks the roadmap's target is drawn from. Every number here is one a client may quote,
 * which is why it is tested directly rather than only through the route.
 */
describe('readBenchmarks', () => {
  it("reads each competitor's LATEST DATE, then exactly that date's rows", async () => {
    /* It used to be `ORDER BY date DESC LIMIT 5` — "the latest five rows", not "the latest day's
       dimensions". A competitor scored on three dimensions that day had two rows from an earlier
       day folded into its composite. */
    _queue.push(
      [{ id: 'c0000000-0000-4000-8000-000000000001', name: 'Rival', weights: null }],
      [{ date: '2026-08-09' }],
      [
        { dimension: 'trust', score: 40, signalCount: 10 },
        { dimension: 'quality', score: 60, signalCount: 10 },
        { dimension: 'value', score: 80, signalCount: 10 },
      ],
    );

    const result = await readBenchmarks(TENANT, BRAND, null);

    expect(result.competitorCount).toBe(1);
    expect(result.competitorMedian).toBeCloseTo(60, 6);
    const rowsQuery = renderedWheres()[2]!;
    expect(rowsQuery.sql).toMatch(/"date" = \$\d/);
    expect(rowsQuery.params).toContain('2026-08-09');
    expect(rowsQuery.params).toContain('all');
  });

  it('skips a competitor that has never been scored', async () => {
    _queue.push(
      [{ id: 'c0000000-0000-4000-8000-000000000001', name: 'Unscored', weights: null }],
      [{ date: null }],
    );
    const result = await readBenchmarks(TENANT, BRAND, null);
    expect(result.competitorCount).toBe(0);
    expect(result.competitorMedian).toBeNull();
    expect(result.competitorBest).toBeNull();
  });

  it("combines the brand's own territories with the BRAND's weights", async () => {
    /* With default weights the "best territory" was not comparable with the headline index, which
       IS weighted. GB: 0.75×40 + 0.25×100 = 55; US: 0.75×60 + 0.25×60 = 60 → US is best at 60.
       Unweighted, GB (70) would have won. */
    _queue.push(
      [],
      [
        { territory: 'GB', dimension: 'trust', score: 40, signalCount: 5 },
        { territory: 'GB', dimension: 'quality', score: 100, signalCount: 5 },
        { territory: 'US', dimension: 'trust', score: 60, signalCount: 5 },
        { territory: 'US', dimension: 'quality', score: 60, signalCount: 5 },
        { territory: 'unknown', dimension: 'trust', score: 99, signalCount: 500 },
      ],
    );

    const result = await readBenchmarks(TENANT, BRAND, '2026-08-09', {
      trust: 0.75,
      quality: 0.25,
    });

    expect(result.internalBest?.value).toBeCloseTo(60, 6);
    expect(result.internalBest?.label).toMatch(/United States|US/);
  });

  it('never offers the unclassified bucket as a comparator', async () => {
    _queue.push([], [{ territory: 'unknown', dimension: 'trust', score: 99, signalCount: 500 }]);
    const result = await readBenchmarks(TENANT, BRAND, '2026-08-09');
    expect(result.internalBest).toBeNull();
  });

  it('is tenant-scoped on every read', async () => {
    _queue.push(
      [{ id: 'c0000000-0000-4000-8000-000000000001', name: 'Rival', weights: null }],
      [{ date: '2026-08-09' }],
      [{ dimension: 'trust', score: 50, signalCount: 1 }],
      [],
    );
    await readBenchmarks(TENANT, BRAND, '2026-08-09');
    for (const w of renderedWheres()) expect(w.params).toContain(TENANT);
  });
});
