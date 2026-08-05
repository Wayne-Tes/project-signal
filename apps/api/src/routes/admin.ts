/**
 * Admin routes — tenant provisioning.
 *
 * POST /admin/tenants — creates tenant + initial brand entity + initial admin user record.
 * Only callable by a user with role=owner (super-admin level).
 */
import { db, tenants, brandEntities, users } from '@project-signal/db';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../plugins/auth.js';

interface CreateTenantBody {
  tenantName: string;
  brandName: string;
  adminFirebaseUid: string;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: CreateTenantBody }>(
    '/admin/tenants',
    {
      preHandler: requireRole('owner'),
      schema: {
        security: [{ BearerAuth: [] }],
        body: {
          type: 'object',
          required: ['tenantName', 'brandName', 'adminFirebaseUid'],
          properties: {
            tenantName: { type: 'string' },
            brandName: { type: 'string' },
            adminFirebaseUid: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantName, brandName, adminFirebaseUid } = request.body;

      const result = await db.get().transaction(async (tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({ name: tenantName, slug: toSlug(tenantName) })
          .returning();

        const [brand] = await tx
          .insert(brandEntities)
          .values({ tenantId: tenant!.id, name: brandName, slug: toSlug(brandName), isOwned: true })
          .returning();

        const [user] = await tx
          .insert(users)
          .values({ firebaseUid: adminFirebaseUid, tenantId: tenant!.id, role: 'admin' })
          .returning();

        return { tenant, brand, user };
      });

      return reply.status(201).send({ status: 'ok', data: result });
    },
  );
}
