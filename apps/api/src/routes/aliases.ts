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
import { requireBrandAccess, requireRole } from '../plugins/auth.js';
import { ID_PARAMS, UUID } from '../lib/http.js';
import { brandInTenant } from '../lib/tenancy.js';

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

const ALIAS_PARAMS = {
  type: 'object',
  required: ['id', 'aliasId'],
  properties: { id: UUID, aliasId: UUID },
} as const;

const CREATE_BODY = {
  type: 'object',
  required: ['alias'],
  additionalProperties: false,
  properties: {
    /* At least one non-space character; trimmed by the handler. An alias is a name, so 200
       characters is generous. */
    alias: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
  },
} as const;

/* Same guard on every route: admin/owner only, plus requireBrandAccess for uniformity with
   every other `/brands/:id…` route. */
const GUARDS = [requireBrandAccess, requireRole('admin', 'owner')];

export async function aliasesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: BrandParams }>(
    '/brands/:id/aliases',
    { preHandler: GUARDS, schema: { params: ID_PARAMS } },
    async (request) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId } = request.params;

      const rows = await db
        .get()
        .select()
        .from(brandAliases)
        .where(
          and(eq(brandAliases.tenantId, tenantId), eq(brandAliases.brandEntityId, brandEntityId)),
        );

      return rows;
    },
  );

  fastify.post<{ Params: BrandParams; Body: CreateAliasBody }>(
    '/brands/:id/aliases',
    { preHandler: GUARDS, schema: { params: ID_PARAMS, body: CREATE_BODY } },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId } = request.params;
      const alias = request.body.alias.trim();

      /* The brand must be the caller's. The write below stamps the CALLER's tenant, so without
         this an admin could attach an alias to another tenant's brand by pasting its id — and
         aliases drive mention matching, so it would quietly change how that brand is read. */
      if (!(await brandInTenant(tenantId, brandEntityId))) {
        return reply.notFound('Brand not found');
      }

      const [row] = await db
        .get()
        .insert(brandAliases)
        .values({ tenantId, brandEntityId, alias })
        .onConflictDoNothing()
        .returning();

      if (!row) {
        return reply.conflict('That alias already exists for this brand.');
      }

      return reply.status(201).send(row);
    },
  );

  fastify.delete<{ Params: AliasParams }>(
    '/brands/:id/aliases/:aliasId',
    { preHandler: GUARDS, schema: { params: ALIAS_PARAMS } },
    async (request, reply) => {
      const tenantId = request.user.tenantId;
      const { id: brandEntityId, aliasId } = request.params;

      const [row] = await db
        .get()
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
        return reply.notFound('Alias not found');
      }

      return row;
    },
  );
}
