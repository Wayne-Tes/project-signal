/**
 * Admin routes — tenant provisioning.
 *
 * POST /admin/tenants — creates tenant + initial brand entity + initial admin user record.
 * Only callable by a user with role=owner (super-admin level).
 */
import { db, tenants, brandEntities, users } from '@project-signal/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireRole } from '../plugins/auth.js';
import { setUserClaims } from '../lib/claims.js';

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
          additionalProperties: false,
          properties: {
            tenantName: { type: 'string', minLength: 1, maxLength: 200 },
            brandName: { type: 'string', minLength: 1, maxLength: 200 },
            /* The Cognito `sub` of the tenant's first admin. Named for the column it lands in
               (`users.firebase_uid`, KNOWN-GAPS #25) rather than for the provider. */
            adminFirebaseUid: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantName, brandName, adminFirebaseUid } = request.body;

      /* An owner naming THEMSELVES as the new tenant's admin would have their claims rewritten
         to `role: admin` in the new tenant by the claims call below — silently demoting the only
         identity able to create tenants at all. Refused; an owner provisions someone else. */
      if (adminFirebaseUid === request.user.uid) {
        return reply.badRequest(
          'You cannot make yourself the new tenant’s admin: that would replace your owner access. Name another user.',
        );
      }

      /* A clear 409 rather than a unique-violation from the insert. `tenants.slug` is unique and
         derived from the name, so two tenants whose names differ only in punctuation collide. */
      const slug = toSlug(tenantName);
      const [clash] = await db
        .get()
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      if (clash) return reply.conflict(`A tenant with the slug '${slug}' already exists.`);

      const result = await db.get().transaction(async (tx) => {
        const [tenant] = await tx.insert(tenants).values({ name: tenantName, slug }).returning();

        const [brand] = await tx
          .insert(brandEntities)
          .values({ tenantId: tenant!.id, name: brandName, slug: toSlug(brandName), isOwned: true })
          .returning();

        const [user] = await tx
          .insert(users)
          .values({ firebaseUid: adminFirebaseUid, tenantId: tenant!.id, role: 'admin' })
          .returning();

        // This flow created the row but never set claims, so the new tenant admin could not
        // authorise a single request — authz reads claims, not this table (KNOWN-GAPS #18).
        // Inside the transaction, so a Cognito failure rolls back the whole tenant rather
        // than leaving a tenant whose only admin cannot sign in to it.
        await setUserClaims(adminFirebaseUid, { role: 'admin', tenantId: tenant!.id });

        return { tenant, brand, user };
      });

      return reply.status(201).send({ status: 'ok', data: result });
    },
  );
}
