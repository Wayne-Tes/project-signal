import type { FastifyPluginAsync } from 'fastify';
import { db, users } from '@project-signal/db';
import { and, eq } from 'drizzle-orm';
import { requireRole, USER_ROLES, type UserRole } from '../plugins/auth.js';
import { setUserClaims } from '../lib/claims.js';
import { ID_PARAMS, UUID } from '../lib/http.js';
import { brandInTenant } from '../lib/tenancy.js';

/**
 * Roles an `admin` may assign. An admin provisions their own tenant's users but cannot mint
 * owners — including by escalating themselves, which the previous PATCH allowed outright.
 */
const ADMIN_ASSIGNABLE_ROLES: readonly UserRole[] = ['admin', 'user'];

const USER_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    firebaseUid: { type: 'string' },
    tenantId: { type: 'string' },
    role: { type: 'string' },
    brandEntityId: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/admin/users',
    {
      preHandler: requireRole('owner', 'admin'),
      schema: {
        security: [{ BearerAuth: [] }],
        body: {
          type: 'object',
          required: ['firebaseUid', 'email', 'role', 'tenantId'],
          additionalProperties: false,
          properties: {
            firebaseUid: { type: 'string', minLength: 1, maxLength: 128 },
            email: { type: 'string', maxLength: 320 },
            role: { type: 'string', enum: [...USER_ROLES] },
            tenantId: UUID,
            brandEntityId: UUID,
          },
        },
        response: { 201: USER_SCHEMA },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        firebaseUid: string;
        email: string;
        role: UserRole;
        tenantId: string;
        brandEntityId?: string;
      };

      // An admin provisions only within their own tenant, and only below owner. An owner is
      // unconstrained — provisioning across tenants is the agency-operator case the product
      // is built around.
      if (request.user.role === 'admin') {
        if (body.tenantId !== request.user.tenantId) {
          return reply.forbidden('Admins may only create users in their own tenant');
        }
        if (!ADMIN_ASSIGNABLE_ROLES.includes(body.role)) {
          return reply.forbidden(`Admins may not assign the role '${body.role}'`);
        }
      }

      if (body.brandEntityId && !(await brandInTenant(body.tenantId, body.brandEntityId))) {
        return reply.badRequest(
          'That brand does not belong to the tenant the user is being created in.',
        );
      }

      // Row and claims are written together: the claims call sits inside the transaction, so
      // a Cognito failure rolls the row back rather than leaving an orphan the user cannot
      // authenticate as (KNOWN-GAPS #18).
      const user = await db.get().transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            firebaseUid: body.firebaseUid,
            tenantId: body.tenantId,
            role: body.role,
            brandEntityId: body.brandEntityId,
          })
          .returning();

        await setUserClaims(body.firebaseUid, {
          role: body.role,
          tenantId: body.tenantId,
          brandEntityId: body.brandEntityId,
        });

        return created;
      });

      return reply.status(201).send(user);
    },
  );

  fastify.patch(
    '/admin/users/:id',
    {
      preHandler: requireRole('owner', 'admin'),
      schema: {
        security: [{ BearerAuth: [] }],
        params: ID_PARAMS,
        body: {
          type: 'object',
          /* THE MASS-ASSIGNMENT FIX, part one. Without `additionalProperties: false` the body
             schema constrained only the two keys it named and let everything else through — and
             the handler spread the body straight into the UPDATE. An admin could PATCH their own
             row with `{ tenantId: <another tenant> }` and the claims call below would then mint
             them admin claims in that tenant; `{ firebaseUid: <someone's sub> }` overwrote
             another identity's claims. Fastify strips undeclared keys once this is set. */
          additionalProperties: false,
          properties: {
            role: { type: 'string', enum: [...USER_ROLES] },
            /* `null` clears the pin. It used to be string-only, so once pinned a user could never
               be returned to tenant-wide access through the API. */
            brandEntityId: { anyOf: [UUID, { type: 'null' }] },
          },
        },
        response: { 200: USER_SCHEMA },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { role?: UserRole; brandEntityId?: string | null };

      // Read the target first: the previous implementation updated on `id` alone, with no
      // tenant filter, so an admin in tenant A could modify a user in tenant B — and could set
      // role='owner' on anyone, including themselves.
      const [target] = await db.get().select().from(users).where(eq(users.id, id));
      if (!target) return reply.notFound('User not found');

      if (request.user.role === 'admin') {
        // 404 rather than 403 for a foreign tenant: do not confirm the row exists.
        if (target.tenantId !== request.user.tenantId) return reply.notFound('User not found');
        if (target.role === 'owner') {
          return reply.forbidden('Admins may not modify an owner');
        }
        if (body.role && !ADMIN_ASSIGNABLE_ROLES.includes(body.role)) {
          return reply.forbidden(`Admins may not assign the role '${body.role}'`);
        }
      }

      if (body.brandEntityId && !(await brandInTenant(target.tenantId, body.brandEntityId))) {
        return reply.badRequest('That brand does not belong to this user’s tenant.');
      }

      /* THE MASS-ASSIGNMENT FIX, part two: the update names its columns. The schema above
         already strips anything undeclared, but the write must not depend on one schema keyword
         being remembered — a future field added to the body would otherwise flow straight into
         the row. Tenant, identity and timestamps are never client-writable here. */
      const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
      if (body.role !== undefined) patch.role = body.role;
      if (body.brandEntityId !== undefined) patch.brandEntityId = body.brandEntityId;

      const updated = await db.get().transaction(async (tx) => {
        const [row] = await tx
          .update(users)
          .set(patch)
          .where(and(eq(users.id, id), eq(users.tenantId, target.tenantId)))
          .returning();

        if (!row) return undefined;

        // Inside the transaction: a claims failure must undo the row change, or a failed
        // demotion would leave the user holding their previous access while the table
        // records the new role.
        await setUserClaims(row.firebaseUid, {
          // `users.role` is a plain varchar in the schema; the app narrows at the boundary,
          // as it does for `source_configs.source` → SignalSource. The value is constrained
          // by the route's body schema enum and by ADMIN_ASSIGNABLE_ROLES above.
          role: row.role as UserRole,
          tenantId: row.tenantId,
          brandEntityId: row.brandEntityId,
        });

        return row;
      });

      if (!updated) return reply.notFound('User not found');

      return updated;
    },
  );

  fastify.get(
    '/admin/users',
    {
      preHandler: requireRole('owner', 'admin'),
      schema: {
        security: [{ BearerAuth: [] }],
        response: {
          200: { type: 'array', items: USER_SCHEMA },
        },
      },
    },
    async (request) => {
      return db.get().select().from(users).where(eq(users.tenantId, request.user.tenantId));
    },
  );
};

export default usersRoutes;
