import type { FastifyPluginAsync } from 'fastify';
import { db, users } from '@project-signal/db';
import { and, eq } from 'drizzle-orm';
import admin from 'firebase-admin';
import { requireRole, type UserRole } from '../plugins/auth.js';

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
          properties: {
            firebaseUid: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string', enum: ['owner', 'admin', 'user'] },
            tenantId: { type: 'string' },
            brandEntityId: { type: 'string' },
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

      const [user] = await db
        .get()
        .insert(users)
        .values({
          firebaseUid: body.firebaseUid,
          tenantId: body.tenantId,
          role: body.role,
          brandEntityId: body.brandEntityId,
        })
        .returning();

      await admin.auth().setCustomUserClaims(body.firebaseUid, {
        role: body.role,
        tenantId: body.tenantId,
        brandEntityId: body.brandEntityId,
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
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['owner', 'admin', 'user'] },
            brandEntityId: { type: 'string' },
          },
        },
        response: { 200: USER_SCHEMA },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { role?: UserRole; brandEntityId?: string };

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

      const [updated] = await db
        .get()
        .update(users)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(users.id, id), eq(users.tenantId, target.tenantId)))
        .returning();

      if (!updated) return reply.notFound('User not found');

      await admin.auth().setCustomUserClaims(updated.firebaseUid, {
        role: updated.role,
        tenantId: updated.tenantId,
        brandEntityId: updated.brandEntityId,
      });

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
