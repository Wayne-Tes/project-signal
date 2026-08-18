import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@project-signal/db';
import { buildTestApp, DEFAULT_ADMIN, DEFAULT_PINNED_USER } from '../helpers/app.js';

let _rows: unknown[] = [];
const _queue: unknown[][] = [];
const _voiceArgs: unknown[][] = [];

vi.mock('@project-signal/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>();
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  const next = () => (_queue.length ? _queue.shift()! : _rows);
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(next()).then(r as never, j as never);
  return {
    ...actual,
    db: { get: vi.fn(() => chain) },
    attributedTo: vi.fn((...a: unknown[]) => {
      _voiceArgs.push(a);
      return { _attributedTo: true };
    }),
  };
});

import voiceRoutes from '../../src/routes/voice.js';

const reported = (over: Record<string, unknown> = {}) => ({
  topic: ['pricing'],
  score: -0.7,
  accountId: 'acc-1',
  arrBand: '250k+',
  territory: 'GB',
  ...over,
});

beforeEach(() => {
  _rows = [];
  _queue.length = 0;
  _voiceArgs.length = 0;
  vi.clearAllMocks();
});

describe('GET /brands/:id/voice-of-customer', () => {
  /**
   * The distinction that matters most in the empty case. "No CRM connected" and "connected and
   * quiet" need opposite responses, and an empty theme list alone cannot tell them apart.
   */
  it('reports not-connected rather than an empty result', async () => {
    _queue.push([]);
    const app = await buildTestApp(voiceRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/voice-of-customer' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.connected).toBe(false);
    expect(body.themes).toEqual([]);
  });

  /**
   * This is the ONE view that asks for the other voice. Everywhere else the default protects the
   * index; here an explicit `reported` is required, and a regression to the default would leave
   * the page silently showing public signals under a CRM heading.
   */
  it('asks explicitly for the reported voice', async () => {
    _queue.push([reported()]);
    _queue.push([]);
    const app = await buildTestApp(voiceRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'GET', url: '/brands/brand-1/voice-of-customer' });

    expect(_voiceArgs[0]![2]).toBe('reported');
  });

  it('reads the public side as direct, for corroboration', async () => {
    _queue.push([reported()]);
    _queue.push([{ topics: ['pricing'], score: -0.3 }]);
    const app = await buildTestApp(voiceRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'GET', url: '/brands/brand-1/voice-of-customer' });

    expect(_voiceArgs[1]![2]).toBe('direct');
  });

  it('ranks by accounts and surfaces the largest band', async () => {
    _queue.push([reported(), reported({ accountId: 'acc-2', arrBand: '<10k' })]);
    _queue.push([]);
    const app = await buildTestApp(voiceRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/voice-of-customer' });

    const body = JSON.parse(res.body);
    expect(body.connected).toBe(true);
    expect(body.themes[0].accounts).toBe(2);
    expect(body.themes[0].topBand).toBe('250k+');
  });

  it('surfaces a subject raised on both sides', async () => {
    _queue.push([reported()]);
    _queue.push([{ topics: ['pricing'], score: -0.2 }]);
    const app = await buildTestApp(voiceRoutes, DEFAULT_ADMIN);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/voice-of-customer' });

    const [c] = JSON.parse(res.body).corroborated;
    expect(c.topic).toBe('pricing');
    /* Both sides reported separately, because they routinely differ — and the gap is the finding. */
    expect(c.publicSentiment).toBeCloseTo(-0.2);
    expect(c.reportedSentiment).toBeCloseTo(-0.7);
  });

  /* With no private side the join is guaranteed empty, so the public read is waste. */
  it('does not read the public side when there is nothing to corroborate against', async () => {
    _queue.push([]);
    const app = await buildTestApp(voiceRoutes, DEFAULT_ADMIN);
    await app.inject({ method: 'GET', url: '/brands/brand-1/voice-of-customer' });
    expect(_voiceArgs).toHaveLength(1);
  });

  it('is brand-scoped', async () => {
    const app = await buildTestApp(voiceRoutes, DEFAULT_PINNED_USER);
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/voice-of-customer' });
    expect(res.statusCode).toBe(403);
  });
});
