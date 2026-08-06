import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import sensible from '@fastify/sensible';
import type { UserClaims } from '../../src/plugins/auth.js';

export type TestUser = UserClaims;

export const DEFAULT_ADMIN: TestUser = {
  uid: 'test-uid',
  role: 'admin',
  tenantId: 'tenant-1',
};

export const DEFAULT_OWNER: TestUser = {
  uid: 'owner-uid',
  role: 'owner',
  tenantId: 'tenant-1',
};

/** Role `user` pinned to a single brand — the case brand-scoped routes must constrain. */
export const DEFAULT_PINNED_USER: TestUser = {
  uid: 'user-uid',
  role: 'user',
  tenantId: 'tenant-1',
  brandEntityId: 'brand-1',
};

export async function buildTestApp(
  plugin: FastifyPluginAsync | ((app: FastifyInstance) => Promise<void>),
  mockUser: TestUser = DEFAULT_ADMIN,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(sensible);

  // Lightweight auth bypass: set request.user without Firebase
  app.decorateRequest<TestUser | null>('user', null);
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: TestUser }).user = mockUser;
  });

  await app.register(plugin);
  await app.ready();

  return app;
}
