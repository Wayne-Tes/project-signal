import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserted: Array<Record<string, unknown>> = [];
let _brands: unknown[] = [];
let _scored: unknown[] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  // The rollup issues two shapes of read: brands (select→from) and scored signals
  // (select→from→innerJoin→where). `innerJoin` decides which result set to return.
  let joined = false;
  ['select', 'from', 'where', 'values', 'onConflictDoUpdate'].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain['innerJoin'] = vi.fn(() => {
    joined = true;
    return chain;
  });
  chain['insert'] = vi.fn(() => chain);
  chain['values'] = vi.fn((v: Record<string, unknown>) => {
    inserted.push(v);
    return chain;
  });
  chain['then'] = (r: unknown, j?: unknown) => {
    const rows = joined ? _scored : _brands;
    joined = false;
    return Promise.resolve(rows).then(r as never, j as never);
  };
  return {
    db: { get: vi.fn(() => chain) },
    brandEntities: {},
    signals: {},
    sentimentResults: {},
    /* The rollup counts signals that MENTION an entity, not only those attributed to it. The
       predicate that expresses that moved to `@project-signal/db` so the API's read paths use
       the identical one — its SQL is covered in `apps/api/test/routes/attributed-to.test.ts`.
       Here it only has to be callable. */
    attributedTo: vi.fn(() => ({ _attributedTo: true })),
    signalMentions: {},
    dimensionScores: { brandEntityId: {}, date: {}, dimension: {}, territory: {} },
    sourceConfigs: {},
    client: { get: vi.fn() },
  };
});

import { rollupDimensionScores } from '../src/rollup.js';

const ASOF = new Date('2026-08-06T12:00:00.000Z');

beforeEach(() => {
  inserted.length = 0;
  _brands = [];
  _scored = [];
  vi.clearAllMocks();
});

describe('rollupDimensionScores', () => {
  it('writes one row per dimension that has data', async () => {
    _brands = [{ id: 'brand-1', tenantId: 'tenant-1', weights: null }];
    _scored = [
      {
        signalId: 's1',
        publishedAt: ASOF,
        score: 0.5,
        confidence: 0.9,
        label: 'positive',
        dimensions: ['trust', 'service'],
        topics: ['support'],
        territory: 'GB',
      },
    ];

    const result = await rollupDimensionScores(ASOF);

    /* Two dimensions x two partitions: the 'all' aggregate and GB. The aggregate is always
       written, from every signal regardless of territory, so it cannot drift from its parts. */
    expect(result).toEqual({ brands: 1, rows: 4 });
    expect(inserted.map((r) => r['dimension']).sort()).toEqual([
      'service',
      'service',
      'trust',
      'trust',
    ]);
    expect([...new Set(inserted.map((r) => r['territory']))].sort()).toEqual(['GB', 'all']);
    expect(inserted[0]).toMatchObject({
      tenantId: 'tenant-1',
      brandEntityId: 'brand-1',
      date: '2026-08-06',
      signalCount: 1,
    });
  });

  it('maps sentiment onto the 0-100 index', async () => {
    _brands = [{ id: 'brand-1', tenantId: 'tenant-1', weights: null }];
    _scored = [
      {
        signalId: 's1',
        publishedAt: ASOF,
        score: 1,
        confidence: 1,
        label: 'positive',
        dimensions: ['trust'],
        topics: [],
      },
    ];

    await rollupDimensionScores(ASOF);

    expect(inserted[0]!['score']).toBeCloseTo(100, 6);
  });

  it('writes nothing for a brand with no scored signals', async () => {
    _brands = [{ id: 'brand-1', tenantId: 'tenant-1', weights: null }];
    _scored = [];

    const result = await rollupDimensionScores(ASOF);

    expect(result).toEqual({ brands: 1, rows: 0 });
    expect(inserted).toHaveLength(0);
  });

  // A null confidence must not be read as full confidence — that would let an unscored row
  // carry the same weight as a confident one.
  it('treats a missing confidence as zero, not as certainty', async () => {
    _brands = [{ id: 'brand-1', tenantId: 'tenant-1', weights: null }];
    _scored = [
      {
        signalId: 's1',
        publishedAt: ASOF,
        score: -1,
        confidence: null,
        label: 'negative',
        dimensions: ['trust'],
        topics: [],
      },
      {
        signalId: 's2',
        publishedAt: ASOF,
        score: 1,
        confidence: 1,
        label: 'positive',
        dimensions: ['trust'],
        topics: [],
      },
    ];

    await rollupDimensionScores(ASOF);

    // The confident positive dominates; a null confidence contributing fully would drag this
    // to the midpoint.
    expect(inserted[0]!['score']).toBeCloseTo(100, 6);
  });

  it('tolerates null dimension and topic arrays', async () => {
    _brands = [{ id: 'brand-1', tenantId: 'tenant-1', weights: null }];
    _scored = [
      {
        signalId: 's1',
        publishedAt: ASOF,
        score: 0.5,
        confidence: 1,
        label: 'positive',
        dimensions: null,
        topics: null,
      },
    ];

    await expect(rollupDimensionScores(ASOF)).resolves.toEqual({ brands: 1, rows: 0 });
  });

  it('upserts so a re-run for the same day overwrites rather than duplicating', async () => {
    _brands = [{ id: 'brand-1', tenantId: 'tenant-1', weights: null }];
    _scored = [
      {
        signalId: 's1',
        publishedAt: ASOF,
        score: 0.5,
        confidence: 1,
        label: 'positive',
        dimensions: ['trust'],
        topics: [],
      },
    ];

    await rollupDimensionScores(ASOF);

    const { db } = await import('@project-signal/db');
    const chain = db.get() as unknown as { onConflictDoUpdate: ReturnType<typeof vi.fn> };
    expect(chain.onConflictDoUpdate).toHaveBeenCalled();
  });

  const at = (signalId: string, territory: string, score: number) => ({
    signalId,
    publishedAt: ASOF,
    score,
    confidence: 1,
    label: score < 0 ? 'negative' : 'positive',
    dimensions: ['trust'],
    topics: [],
    territory,
  });

  it('writes each territory from its own signals and the aggregate from all of them', async () => {
    /* Two territories with opposite sentiment: each partition must see only its own signals, and
       the 'all' row must see both — the aggregate cannot drift from its parts. */
    _brands = [{ id: 'brand-1', tenantId: 'tenant-1' }];
    _scored = [at('s1', 'GB', 1), at('s2', 'AU', -1), at('s3', 'GB', 1)];

    await rollupDimensionScores(ASOF);

    const byTerritory = Object.fromEntries(inserted.map((r) => [r['territory'], r]));
    expect(byTerritory['GB']).toMatchObject({ signalCount: 2 });
    expect(byTerritory['GB']!['score']).toBeCloseTo(100, 6);
    expect(byTerritory['AU']).toMatchObject({ signalCount: 1 });
    expect(byTerritory['AU']!['score']).toBeCloseTo(0, 6);
    expect(byTerritory['all']).toMatchObject({ signalCount: 3 });
  });

  it('terminates, and does not double-count, when a signal carries the literal territory "all"', async () => {
    /* The aggregate partition used to be the SAME array as the one being iterated, so pushing an
       'all' signal onto its "own" partition grew the array under the loop and never ended. */
    _brands = [{ id: 'brand-1', tenantId: 'tenant-1' }];
    _scored = [at('s1', 'all', 1), at('s2', 'GB', -1)];

    const result = await rollupDimensionScores(ASOF);

    expect(result.rows).toBe(2);
    const all = inserted.find((r) => r['territory'] === 'all');
    expect(all).toMatchObject({ signalCount: 2 });
  });
});
