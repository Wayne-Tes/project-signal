import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { httpBasics } from '../../src/lib/http.js';
import { DEFAULT_RATE_LIMIT, rateLimitKey, registerRateLimit } from '../../src/lib/rate-limit.js';

/**
 * Rate limiting is per USER, not per address: the assistant re-enters the API through
 * `app.inject` from 127.0.0.1 for every user at once, and many people can share one egress IP.
 */

async function build(users: Record<string, { uid: string; tenantId: string }>) {
  const app = Fastify({ logger: false });
  await app.register(httpBasics);
  // Stand-in for the auth plugin: an application-level onRequest hook that sets request.user,
  // registered BEFORE the limiter exactly as main.ts registers them.
  app.decorateRequest<{ uid: string; tenantId: string } | null>('user', null);
  app.addHook('onRequest', async (req) => {
    const who = req.headers['x-user'];
    if (typeof who === 'string' && users[who]) {
      (req as unknown as { user: unknown }).user = users[who];
    }
  });
  await registerRateLimit(app);
  app.get('/tight', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({
    ok: true,
  }));
  app.get('/default', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('rateLimitKey', () => {
  it('keys an authenticated request by tenant and user', () => {
    const req = {
      user: { uid: 'u1', tenantId: 't1' },
      ip: '10.0.0.1',
    } as unknown as FastifyRequest;
    expect(rateLimitKey(req)).toBe('user:t1:u1');
  });

  it('falls back to the address for an unauthenticated request', () => {
    const req = { ip: '10.0.0.1' } as unknown as FastifyRequest;
    expect(rateLimitKey(req)).toBe('ip:10.0.0.1');
  });
});

describe('registerRateLimit', () => {
  const USERS = {
    alice: { uid: 'alice', tenantId: 't1' },
    bob: { uid: 'bob', tenantId: 't1' },
  };

  it('enforces a route-level ceiling with a 429', async () => {
    const app = await build(USERS);
    const hit = () => app.inject({ method: 'GET', url: '/tight', headers: { 'x-user': 'alice' } });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    const third = await hit();
    expect(third.statusCode).toBe(429);
    expect(JSON.parse(third.body).error).toBe('Too Many Requests');
  });

  it('counts each user separately, even from the same address', async () => {
    /* inject always comes from 127.0.0.1 — keyed by IP, alice would exhaust bob's budget. */
    const app = await build(USERS);
    for (let i = 0; i < 2; i += 1) {
      await app.inject({ method: 'GET', url: '/tight', headers: { 'x-user': 'alice' } });
    }
    const bob = await app.inject({ method: 'GET', url: '/tight', headers: { 'x-user': 'bob' } });
    expect(bob.statusCode).toBe(200);
  });

  it('applies a generous default to every other route', async () => {
    const app = await build(USERS);
    const res = await app.inject({
      method: 'GET',
      url: '/default',
      headers: { 'x-user': 'alice' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe(String(DEFAULT_RATE_LIMIT.max));
  });
});
