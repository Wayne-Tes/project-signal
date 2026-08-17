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
