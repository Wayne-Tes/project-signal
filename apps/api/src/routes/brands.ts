import type { FastifyPluginAsync } from 'fastify';
import { db, brandEntities } from '@project-signal/db';
import { and, eq } from 'drizzle-orm';

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

  fastify.get('/brands/:id', {
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
