import type { FastifyPluginAsync } from 'fastify';
import { db, users } from '@project-signal/db';
import { eq } from 'drizzle-orm';
import admin from 'firebase-admin';
import { requireRole } from '../plugins/auth.js';

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
  fastify.post('/admin/users', {
    preHandler: requireRole('owner'),
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
  }, async (request, reply) => {
    const body = request.body as {
      firebaseUid: string;
      email: string;
      role: 'owner' | 'admin' | 'user';
      tenantId: string;
      brandEntityId?: string;
    };

    const [user] = await db.get().insert(users).values({
      firebaseUid: body.firebaseUid,
      tenantId: body.tenantId,
      role: body.role,
      brandEntityId: body.brandEntityId,
    }).returning();

    await admin.auth().setCustomUserClaims(body.firebaseUid, {
      role: body.role,
      tenantId: body.tenantId,
      brandEntityId: body.brandEntityId,
    });

    return reply.status(201).send(user);
  });

  fastify.patch('/admin/users/:id', {
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
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { role?: 'owner' | 'admin' | 'user'; brandEntityId?: string };

    const [updated] = await db.get().update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();

    if (!updated) return reply.notFound('User not found');

    await admin.auth().setCustomUserClaims(updated.firebaseUid, {
      role: updated.role,
      tenantId: updated.tenantId,
      brandEntityId: updated.brandEntityId,
    });

    return updated;
  });

  fastify.get('/admin/users', {
    preHandler: requireRole('owner', 'admin'),
    schema: {
      security: [{ BearerAuth: [] }],
      response: {
        200: { type: 'array', items: USER_SCHEMA },
      },
    },
  }, async (request) => {
    return db.get().select().from(users).where(eq(users.tenantId, request.user.tenantId));
  });
};

export default usersRoutes;
