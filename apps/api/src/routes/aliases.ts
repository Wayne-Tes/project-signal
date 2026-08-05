/**
 * Brand alias routes — manage alternative names / abbreviations for a brand entity.
 *
 * All routes are scoped to the authenticated tenant via request.user.tenantId.
 * Requires admin or higher role.
 *
 * GET    /brands/:id/aliases            — list aliases for a brand
 * POST   /brands/:id/aliases            — add an alias  { alias }
 * DELETE /brands/:id/aliases/:aliasId   — remove an alias
 */
import { db, brandAliases } from '@project-signal/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../plugins/auth.js';

interface BrandParams {
  id: string;
}

interface AliasParams {
  id: string;
  aliasId: string;
}

interface CreateAliasBody {
  alias: string;
}

export async function aliasesRoutes(fastify: FastifyInstance): Promise<void> {
  const database = db.get();

  fastify.get<{ Params: BrandParams }>(
    '/brands/:id/aliases',
    { preHandler: requireRole('admin', 'owner') },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId } = request.params;

      const rows = await database
        .select()
        .from(brandAliases)
        .where(
          and(
            eq(brandAliases.tenantId, tenantId),
            eq(brandAliases.brandEntityId, brandEntityId),
          ),
        );

      return reply.status(200).send({ status: 'ok', data: rows });
    },
  );

  fastify.post<{ Params: BrandParams; Body: CreateAliasBody }>(
    '/brands/:id/aliases',
    { preHandler: requireRole('admin', 'owner') },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId } = request.params;
      const alias = request.body?.alias?.trim();

      if (!alias) {
        return reply.status(400).send({ status: 'error', error: 'alias is required' });
      }

      const [row] = await database
        .insert(brandAliases)
        .values({ tenantId, brandEntityId, alias })
        .onConflictDoNothing()
        .returning();

      if (!row) {
        return reply.status(409).send({ status: 'error', error: 'alias already exists' });
      }

      return reply.status(201).send({ status: 'ok', data: row });
    },
  );

  fastify.delete<{ Params: AliasParams }>(
    '/brands/:id/aliases/:aliasId',
    { preHandler: requireRole('admin', 'owner') },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId, aliasId } = request.params;

      const [row] = await database
        .delete(brandAliases)
        .where(
          and(
            eq(brandAliases.id, aliasId),
            eq(brandAliases.tenantId, tenantId),
            eq(brandAliases.brandEntityId, brandEntityId),
          ),
        )
        .returning();

      if (!row) {
        return reply.status(404).send({ status: 'error', error: 'alias not found' });
      }

      return reply.status(200).send({ status: 'ok', data: row });
    },
  );
}
