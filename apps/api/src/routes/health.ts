import type { FastifyPluginAsync } from 'fastify';
import { db } from '@project-signal/db';
import { sql } from 'drizzle-orm';

const HEALTH_SCHEMA = {
  response: {
    200: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        service: { type: 'string' },
      },
    },
    503: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        service: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
};

/**
 * Liveness and readiness.
 *
 * `/health` — the process is up. Cheap, touches nothing; the load balancer's health check.
 *
 * `/ready` — the process can do its job, which for this API means the database answers. It used
 * to return ok unconditionally, so it reported ready while every real request was failing on a
 * lost or misconfigured connection — a readiness probe that cannot say "not ready" is not one.
 * The reason is generic: this endpoint is public, and a driver error can carry a hostname.
 */
export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', { schema: HEALTH_SCHEMA }, async () => ({ status: 'ok', service: 'api' }));

  fastify.get('/ready', { schema: HEALTH_SCHEMA }, async (request, reply) => {
    try {
      await db.get().execute(sql`select 1`);
      return { status: 'ok', service: 'api' };
    } catch (err) {
      request.log.error({ err }, 'readiness check: database unreachable');
      return reply
        .code(503)
        .send({ status: 'unavailable', service: 'api', reason: 'database unreachable' });
    }
  });
};

export default healthRoutes;
