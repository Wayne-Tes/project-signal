import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import type { UserClaims } from '../../src/plugins/auth.js';
import { httpBasics } from '../../src/lib/http.js';

export type TestUser = UserClaims;

/**
 * Fixed uuids for test fixtures.
 *
 * Every id in the API is validated as a uuid, so a fixture id like `'brand-1'` is now a 400 at
 * the schema rather than a lookup. These are named so a test still reads as "brand 1" while
 * being a value the API accepts.
 */
export const IDS = {
  tenant1: '11111111-1111-4111-8111-111111111111',
  tenant2: '22222222-2222-4222-8222-222222222222',
  brand1: 'b1111111-1111-4111-8111-111111111111',
  brand2: 'b2222222-2222-4222-8222-222222222222',
  brand3: 'b3333333-3333-4333-8333-333333333333',
  brand9: 'b9999999-9999-4999-8999-999999999999',
} as const;

/** A deterministic, valid v4-shaped uuid for any short label — for fixtures beyond `IDS`. */
export function uuidFor(label: string): string {
  let h = 0x811c9dc5;
  for (const ch of label) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  const a = hex(h);
  const b = hex(Math.imul(h, 2654435761) >>> 0);
  const c = hex(Math.imul(h ^ 0x9e3779b9, 40503) >>> 0);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c}${a.slice(0, 4)}`;
}

export const DEFAULT_ADMIN: TestUser = {
  uid: 'test-uid',
  role: 'admin',
  tenantId: IDS.tenant1,
};

export const DEFAULT_OWNER: TestUser = {
  uid: 'owner-uid',
  role: 'owner',
  tenantId: IDS.tenant1,
};

/** Role `user` pinned to a single brand — the case brand-scoped routes must constrain. */
export const DEFAULT_PINNED_USER: TestUser = {
  uid: 'user-uid',
  role: 'user',
  tenantId: IDS.tenant1,
  brandEntityId: IDS.brand1,
};

export async function buildTestApp(
  plugin: FastifyPluginAsync | ((app: FastifyInstance) => Promise<void>),
  mockUser: TestUser = DEFAULT_ADMIN,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // The same sensible + error boundary production registers, so tests see production's error
  // responses — including that a 5xx never carries an error's own message.
  await app.register(httpBasics);

  // Lightweight auth bypass: set request.user without an identity provider
  app.decorateRequest<TestUser | null>('user', null);
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: TestUser }).user = mockUser;
  });

  await app.register(plugin);
  await app.ready();

  return app;
}
