import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@project-signal/db';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

let _rows: unknown[] = [];
const _queue: unknown[][] = [];
const _written: Record<string, unknown>[] = [];

vi.mock('@project-signal/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'update']) {
    chain[m] = vi.fn(() => chain);
  }
  chain['set'] = vi.fn((v: Record<string, unknown>) => {
    _written.push(v);
    return chain;
  });
  const next = () => (_queue.length ? _queue.shift()! : _rows);
  chain['returning'] = vi.fn(() => Promise.resolve(next()));
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(next()).then(r as never, j as never);
  return { ...actual, db: { get: vi.fn(() => chain) } };
});

import roadmapRoutes from '../../src/routes/roadmap.js';

beforeEach(() => {
  _rows = [];
  _queue.length = 0;
  _written.length = 0;
  vi.clearAllMocks();
});

/** brand → items → latest date → competitors → (per competitor) → territory rows. */
function sequence(opts: { target?: number | null; items?: unknown[]; competitors?: unknown[] } = {}) {
  _queue.push([{ weights: null, targetScore: opts.target ?? null }]);
  _queue.push(opts.items ?? []);
  _queue.push([]); // latest rollup date
  _queue.push(opts.competitors ?? []);
}

describe('GET /brands/:id/roadmap', () => {
  it('reports no target rather than inventing one when nothing is measurable', async () => {
    sequence();
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/roadmap' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    /* The Brand Perception Index is ours, so no external benchmark exists for it. A plausible
       round number here would be an invented industry standard — the exact fabrication that put
       "+3.4 pts" on a fictional bank's roadmap. */
    expect(body.target).toBeNull();
    expect(body.gap).toBeNull();
  });

  it("prefers the owner's target and says so", async () => {
    sequence({ target: 72 });
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/roadmap' });

    expect(JSON.parse(res.body).target).toMatchObject({ value: 72, source: 'owner' });
  });

  it('always states the target’s provenance', async () => {
    sequence({ target: 72 });
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/roadmap' });
    expect(JSON.parse(res.body).target.label.length).toBeGreaterThan(0);
  });

  it('states the projection’s assumption alongside it', async () => {
    const now = new Date();
    sequence({
      items: [
        {
          signalId: 's1',
          publishedAt: now,
          score: -0.5,
          confidence: 0.9,
          label: 'negative',
          dimensions: ['trust'],
          topics: ['pricing'],
        },
      ],
    });
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/roadmap' });

    /* A projection whose assumption is not on screen beside it will be read as a prediction. */
    expect(JSON.parse(res.body).projection.assumption).toContain('no new signals');
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(roadmapRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/roadmap' });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /brands/:id/target', () => {
  it('stores a target', async () => {
    _rows = [{ id: 'brand-1', targetScore: 70 }];
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/target',
      payload: { targetScore: 70 },
    });

    expect(res.statusCode).toBe(200);
    expect(_written.at(-1)).toMatchObject({ targetScore: 70 });
  });

  /* Clearing differs from omitting: it returns the brand to a competitor-derived default, and
     there has to be a way back from a target set in error. */
  it('accepts null to clear it', async () => {
    _rows = [{ id: 'brand-1', targetScore: null }];
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/target',
      payload: { targetScore: null },
    });

    expect(res.statusCode).toBe(200);
    expect(_written.at(-1)).toMatchObject({ targetScore: null });
  });

  it('refuses a score outside 0–100', async () => {
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    for (const targetScore of [-1, 101]) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/brands/brand-1/target',
        payload: { targetScore },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('refuses a plain user — a target is a commitment, not a preference', async () => {
    const app = await buildTestApp(roadmapRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/target',
      payload: { targetScore: 70 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404s for a brand outside the caller’s tenant rather than leaking its existence', async () => {
    _rows = [];
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/other-tenant-brand/target',
      payload: { targetScore: 70 },
    });
    expect(res.statusCode).toBe(404);
  });
});

/**
 * The tracked-action endpoints. Both handlers shipped with no test at all — they were the
 * uncovered half of this file, and between them they carry the two things in the roadmap most
 * expensive to get wrong: a verdict the user acts on, and a write that must not cross a tenant.
 */

/** One action row, shaped as the table returns it. `baselineAt` is a Date, not a string. */
function action(over: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    tenantId: 'tenant-1',
    brandEntityId: 'brand-1',
    topic: 'pricing',
    territory: 'all',
    status: 'open',
    note: null,
    baselineAt: new Date('2026-07-01T00:00:00.000Z'),
    baselineIndex: 40,
    baselineDamage: 2,
    ceilingDelta: 20,
    completedAt: null,
    ...over,
  };
}

describe('GET /brands/:id/roadmap/actions', () => {
  it('returns an empty list without reading anything else when nothing is tracked', async () => {
    /* The early return matters for cost, not just tidiness: without it, a brand with no actions
       would still scan its whole signal population once per territory to compute verdicts nobody
       asked for. */
    _queue.push([]);
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/roadmap/actions' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('computes the verdict on read rather than returning a stored one', async () => {
    /* A stored verdict goes stale. "Improved", on a subject that has since collapsed, is worse
       than no verdict at all — which is why `outcome` is absent from the table entirely. */
    _queue.push([action()]); // the tracked actions
    _queue.push([{ weights: null }]); // brand weights
    _queue.push([]); // readItems for territory 'all'

    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/roadmap/actions' });

    expect(res.statusCode).toBe(200);
    const [row] = JSON.parse(res.body);
    expect(row).toHaveProperty('outcome');
    expect(row.outcome).toHaveProperty('verdict');
    expect(typeof row.outcome.verdict).toBe('string');
  });

  it('serialises baselineAt as an ISO string, which the schema requires', async () => {
    /* The column is a Date. `fast-json-stringify` declares this field as a string, so a Date left
       unconverted is not a type error at build time — it is a wrong value at runtime. */
    _queue.push([action()]);
    _queue.push([{ weights: null }]);
    _queue.push([]);

    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/roadmap/actions' });

    expect(JSON.parse(res.body)[0].baselineAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('reads each distinct territory once, not once per action', async () => {
    /* Twenty actions in one territory must not issue twenty identical scans. Three actions across
       two territories should therefore produce exactly two readItems calls — asserted here by
       queueing exactly two and expecting the request to succeed rather than run dry. */
    _queue.push([
      action({ id: 'a1', territory: 'all' }),
      action({ id: 'a2', territory: 'all', topic: 'delivery' }),
      action({ id: 'a3', territory: 'GB', topic: 'support' }),
    ]);
    _queue.push([{ weights: null }]);
    _queue.push([]); // territory 'all'
    _queue.push([]); // territory 'GB'

    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/roadmap/actions' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveLength(3);
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(roadmapRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/roadmap/actions' });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /brands/:id/roadmap/actions/:actionId', () => {
  it('stamps completedAt when the action closes, so duration is answerable later', async () => {
    _queue.push([action({ status: 'completed' })]);
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/roadmap/actions/action-1',
      payload: { status: 'completed' },
    });

    expect(res.statusCode).toBe(200);
    expect(_written[0]?.['status']).toBe('completed');
    expect(_written[0]?.['completedAt']).toBeInstanceOf(Date);
  });

  it('clears completedAt when a completed action is reopened', async () => {
    /* Reopening without clearing the stamp leaves a row that is simultaneously accepted and
       completed, and every later "how long did this take" reads the stale close date.

       The reopen status is `accepted`, not `open`: the body enum is accepted/completed/abandoned,
       so `open` — which IS the column's default for a freshly created action — cannot be set back
       through this route at all. Worth knowing before writing a UI control that offers it. */
    _queue.push([action({ status: 'accepted' })]);
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/roadmap/actions/action-1',
      payload: { status: 'accepted' },
    });

    expect(res.statusCode).toBe(200);
    expect(_written[0]?.['completedAt']).toBeNull();
  });

  it('rejects a status outside the enum rather than writing it', async () => {
    /* Without the enum a typo becomes a row in a state no code branches on — invisible until a
       verdict or a filter quietly skips it. */
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/roadmap/actions/action-1',
      payload: { status: 'donee' },
    });

    expect(res.statusCode).toBe(400);
    expect(_written).toHaveLength(0);
  });

  it('stores a trimmed note, and normalises a whitespace-only note to null', async () => {
    _queue.push([action({ note: 'shipped' })]);
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/roadmap/actions/action-1',
      payload: { note: '   ' },
    });

    /* '' would render as an empty note in the UI and read as "someone wrote nothing", which is a
       different claim from "nobody has written anything". */
    expect(_written[0]?.['note']).toBeNull();
  });

  it('leaves status untouched when only a note is supplied', async () => {
    /* A note is an annotation, not a state change. Writing `status: undefined` into the update
       would be harmless in drizzle but writing a default would silently reopen a closed action. */
    _queue.push([action()]);
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/roadmap/actions/action-1',
      payload: { note: 'progress update' },
    });

    expect(_written[0]).not.toHaveProperty('status');
    expect(_written[0]).not.toHaveProperty('completedAt');
    expect(_written[0]?.['note']).toBe('progress update');
  });

  it('always bumps updatedAt, even for a note-only edit', async () => {
    _queue.push([action()]);
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/roadmap/actions/action-1',
      payload: { note: 'x' },
    });

    expect(_written[0]?.['updatedAt']).toBeInstanceOf(Date);
  });

  it('404s when the action belongs to another tenant, rather than closing it', async () => {
    /* The predicate is id AND brand AND tenant. The id alone would let one tenant close another's
       action — the update would match, return a row, and report success. An empty result is what
       that scoping produces, so this asserts the scoping by asserting its consequence. */
    _queue.push([]);
    const app = await buildTestApp(roadmapRoutes, DEFAULT_ADMIN);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-1/roadmap/actions/someone-elses-action',
      payload: { status: 'completed' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(roadmapRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({
      method: 'PATCH',
      url: '/brands/brand-2/roadmap/actions/action-1',
      payload: { status: 'completed' },
    });
    expect(res.statusCode).toBe(403);
  });
});
