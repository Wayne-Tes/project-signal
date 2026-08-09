import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, DEFAULT_ADMIN } from '../helpers/app.js';

const whereCalls: unknown[] = [];
let rows: unknown[] = [];
const rowQueue: unknown[][] = [];

vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'insert', 'values', 'update', 'set', 'delete', 'orderBy', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  chain['where'] = vi.fn((c: unknown) => {
    whereCalls.push(c);
    return chain;
  });
  const next = () => (rowQueue.length ? rowQueue.shift()! : rows);
  chain['returning'] = vi.fn(() => Promise.resolve(next()));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(next()).then(r as never, j as never);
  return {
    db: { get: vi.fn(() => chain) },
    brandEntities: { id: 'id', tenantId: 'tenant_id', name: 'name', kind: 'kind', parentId: 'parent_id' },
    dimensionScores: { brandEntityId: 'brand_entity_id', tenantId: 'tenant_id', date: 'date', dimension: 'dimension', score: 'score', signalCount: 'signal_count' },
    tenants: {}, signals: {}, users: {}, sentimentResults: {}, sourceConfigs: {},
    brandAliases: {}, signalMentions: {}, scanRuns: {},
    conversations: {}, conversationMessages: {}, client: { get: vi.fn() },
  };
});

const { portfolioRoutes, descendantsOf } = await import('../../src/routes/portfolio.js');

/**
 * The portfolio index.
 *
 * Two questions are being asked of a group like Tes and they are not the same: "how is the brand
 * seen" and "how is what it sells seen". This endpoint answers the second, which is why it is a
 * separate figure rather than a change to the brand's own score.
 */

const AUTH = { authorization: 'Bearer t' };

beforeEach(() => {
  vi.clearAllMocks();
  whereCalls.length = 0;
  rowQueue.length = 0;
  rows = [];
});

describe('descendantsOf', () => {
  it('walks past the immediate children', async () => {
    /* brand → division → product. Depth is arbitrary by design, so the walk must not stop at
       one level. */
    rowQueue.push([{ id: 'division' }], [{ id: 'product' }], []);
    expect(await descendantsOf('tenant-1', 'root')).toEqual(['division', 'product']);
  });

  it('returns nothing for a leaf', async () => {
    rowQueue.push([]);
    expect(await descendantsOf('tenant-1', 'leaf')).toEqual([]);
  });

  it('terminates on cyclic data rather than hanging', async () => {
    /* The API's cycle guard should make this impossible, but if a cycle ever reaches the table
       by another path this read must still finish. A visited set, not recursion into the data. */
    for (let i = 0; i < 40; i += 1) rowQueue.push([{ id: 'a' }, { id: 'b' }]);
    await expect(descendantsOf('tenant-1', 'a')).resolves.toEqual(['b']);
  });
});

describe('GET /brands/:id/portfolio', () => {
  it('reports an empty portfolio for a brand with no products', async () => {
    /* Not a score of zero. "Nothing beneath this" and "everything beneath this is terrible" are
       very different statements, and zero is the second one. */
    rowQueue.push([]);
    const app = await buildTestApp(portfolioRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/b1/portfolio', headers: AUTH });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.score).toBeNull();
    expect(body.memberCount).toBe(0);
  });

  it('weights by signal volume, not equally', async () => {
    /* THE central decision. A product with 1000 signals scoring 40 and one with 10 scoring 90
       must not average to 65 — the portfolio is dominated by what people actually talk about.
       Volume-weighted: (40*1000 + 90*10) / 1010 = 40.5. */
    rowQueue.push(
      [{ id: 'loud' }, { id: 'quiet' }],
      [],
      [
        { id: 'loud', name: 'Loud', kind: 'product' },
        { id: 'quiet', name: 'Quiet', kind: 'product' },
      ],
      [
        { brandEntityId: 'loud', date: '2026-08-09', dimension: 'trust', score: 40, signalCount: 1000 },
        { brandEntityId: 'quiet', date: '2026-08-09', dimension: 'trust', score: 90, signalCount: 10 },
      ],
    );
    const app = await buildTestApp(portfolioRoutes, DEFAULT_ADMIN);
    const body = JSON.parse((await app.inject({ method: 'GET', url: '/brands/b1/portfolio', headers: AUTH })).body);

    expect(body.score).toBe(40.5);
    expect(body.signalCount).toBe(1010);
    expect(body.memberCount).toBe(2);
  });

  it('uses only each entity’s latest rollup date', async () => {
    /* Earlier dates are history and belong to the trend chart. Averaging them into today's
       portfolio would make the number lag reality by however much history exists. */
    rowQueue.push(
      [{ id: 'p1' }],
      [],
      [{ id: 'p1', name: 'P1', kind: 'product' }],
      [
        { brandEntityId: 'p1', date: '2026-08-09', dimension: 'trust', score: 80, signalCount: 10 },
        { brandEntityId: 'p1', date: '2026-01-01', dimension: 'trust', score: 10, signalCount: 10 },
      ],
    );
    const app = await buildTestApp(portfolioRoutes, DEFAULT_ADMIN);
    const body = JSON.parse((await app.inject({ method: 'GET', url: '/brands/b1/portfolio', headers: AUTH })).body);
    expect(body.score).toBe(80);
  });

  it('does not over-count signals across dimensions', async () => {
    /* signal_count is per dimension and one signal can touch several, so summing across
       dimensions would inflate the weight of any product discussed in the round. */
    rowQueue.push(
      [{ id: 'p1' }],
      [],
      [{ id: 'p1', name: 'P1', kind: 'product' }],
      [
        { brandEntityId: 'p1', date: '2026-08-09', dimension: 'trust', score: 60, signalCount: 50 },
        { brandEntityId: 'p1', date: '2026-08-09', dimension: 'quality', score: 80, signalCount: 50 },
      ],
    );
    const app = await buildTestApp(portfolioRoutes, DEFAULT_ADMIN);
    const body = JSON.parse((await app.inject({ method: 'GET', url: '/brands/b1/portfolio', headers: AUTH })).body);

    expect(body.signalCount, 'not 100').toBe(50);
    /* And the entity's own index is the mean of its dimensions. */
    expect(body.members[0].score).toBe(70);
  });

  it('reports an unscored product as null, and excludes it from the index', async () => {
    /* A product with no rollup yet must not be read as scoring zero — that would drag the
       portfolio down for a product nobody has said anything about. */
    rowQueue.push(
      [{ id: 'scored' }, { id: 'new' }],
      [],
      [
        { id: 'scored', name: 'Scored', kind: 'product' },
        { id: 'new', name: 'New', kind: 'product' },
      ],
      [{ brandEntityId: 'scored', date: '2026-08-09', dimension: 'trust', score: 70, signalCount: 20 }],
    );
    const app = await buildTestApp(portfolioRoutes, DEFAULT_ADMIN);
    const body = JSON.parse((await app.inject({ method: 'GET', url: '/brands/b1/portfolio', headers: AUTH })).body);

    expect(body.score).toBe(70);
    expect(body.memberCount).toBe(2);
    expect(body.scoredMemberCount).toBe(1);
    expect(body.members.find((m: { name: string }) => m.name === 'New').score).toBeNull();
  });

  it('falls back to an equal-weighted mean rather than dividing by zero', async () => {
    /* Possible if a rollup ever writes a score with no count. NaN reaching a dashboard as a
       score is worse than a slightly less precise number. */
    rowQueue.push(
      [{ id: 'a' }, { id: 'b' }],
      [],
      [
        { id: 'a', name: 'A', kind: 'product' },
        { id: 'b', name: 'B', kind: 'product' },
      ],
      [
        { brandEntityId: 'a', date: '2026-08-09', dimension: 'trust', score: 40, signalCount: 0 },
        { brandEntityId: 'b', date: '2026-08-09', dimension: 'trust', score: 60, signalCount: 0 },
      ],
    );
    const app = await buildTestApp(portfolioRoutes, DEFAULT_ADMIN);
    const body = JSON.parse((await app.inject({ method: 'GET', url: '/brands/b1/portfolio', headers: AUTH })).body);
    expect(body.score).toBe(50);
    expect(Number.isNaN(body.score)).toBe(false);
  });

  it('is tenant-scoped at every step', async () => {
    rowQueue.push([{ id: 'p1' }], [], [{ id: 'p1', name: 'P1', kind: 'product' }], []);
    const app = await buildTestApp(portfolioRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'GET', url: '/brands/b1/portfolio', headers: AUTH });
    /* Descendant walk, entity load and score load each filter tenant independently — none of
       them relies on an earlier query having done it. */
    expect(JSON.stringify(whereCalls)).toContain('tenant_id');
  });
});
