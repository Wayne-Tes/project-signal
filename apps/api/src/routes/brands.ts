import type { FastifyPluginAsync } from 'fastify';
import { db, brandEntities } from '@project-signal/db';
import { and, eq } from 'drizzle-orm';
import { requireBrandAccess } from '../plugins/auth.js';

const BRAND_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    isOwned: { type: 'boolean' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

const brandsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/brands', {
    schema: {
      security: [{ BearerAuth: [] }],
      response: { 200: { type: 'array', items: BRAND_SCHEMA } },
    },
  }, async (request) => {
    const { tenantId, role, brandEntityId } = request.user;
    const baseCondition = eq(brandEntities.tenantId, tenantId);

    if (role === 'user' && brandEntityId) {
      return db.get().select().from(brandEntities).where(
        and(baseCondition, eq(brandEntities.id, brandEntityId)),
      );
    }

    return db.get().select().from(brandEntities).where(baseCondition);
  });

  // `requireBrandAccess` applies here for the same reason it applies to every other
  // `/brands/:id/*` route: the tenant filter below closes cross-tenant reads, but without the
  // guard a `user` pinned to brand A could still read brand B's row — including a competitor
  // tracked by the same tenant — by changing the id in the URL. Only the brand's metadata
  // leaked rather than its signals, which is why this route was missed when KNOWN-GAPS #5 was
  // closed across the analytical endpoints; it is the same defect at a smaller blast radius.
  fastify.get('/brands/:id', {
    preHandler: requireBrandAccess,
    schema: {
      security: [{ BearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: { 200: BRAND_SCHEMA },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [brand] = await db.get().select().from(brandEntities).where(
      and(eq(brandEntities.id, id), eq(brandEntities.tenantId, request.user.tenantId)),
    );

    if (!brand) return reply.notFound('Brand not found');
    return brand;
  });
};

export default brandsRoutes;
