import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Default ceiling for every route: generous for a person, a wall for a runaway client.
 *
 * Per USER, not per IP. Behind the load balancer many people can share an egress address, and
 * the assistant re-enters this API through `app.inject` (assistant/tools.ts) — from 127.0.0.1,
 * for every user at once. Keyed by IP, one busy assistant would rate-limit everybody.
 */
export const DEFAULT_RATE_LIMIT = { max: 300, timeWindow: '1 minute' } as const;

/**
 * The key a request is counted against: the authenticated subject when there is one, the client
 * address otherwise (only public routes — health, docs, local sign-in — reach this unauthenticated).
 */
export function rateLimitKey(request: FastifyRequest): string {
  const uid = (request as { user?: { uid?: string; tenantId?: string } }).user?.uid;
  const tenantId = (request as { user?: { tenantId?: string } }).user?.tenantId;
  return uid ? `user:${tenantId ?? ''}:${uid}` : `ip:${request.ip}`;
}

/**
 * Registers `@fastify/rate-limit` for the whole application.
 *
 * MUST be registered AFTER the auth plugin. The limiter attaches a route-level `onRequest` hook to
 * each route, and route-level hooks run after application-level ones — so by the time it counts
 * a request, auth has set `request.user` and the key above is the user, not the address. Routes
 * tighten the default with `config: { rateLimit: { … } }`.
 */
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    ...DEFAULT_RATE_LIMIT,
    keyGenerator: rateLimitKey,
  });
}
