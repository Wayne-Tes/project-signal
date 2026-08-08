import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import type { UserClaims } from '../../src/plugins/auth.js';

const mockVerifyIdToken = vi.fn();

// aws-jwt-verify does the signature, issuer, audience, token-use and expiry checks against the
// pool's JWKS. Mocking the verifier means these tests cover what the PLUGIN does with a verified
// payload — claim extraction, the unpinned-user case, and rejecting a token that verifies but
// carries no tenant or role. It deliberately does not re-test JWT verification itself.
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: vi.fn(() => ({ verify: mockVerifyIdToken })),
  },
}));

// The plugin reads the pool and client id at registration and refuses to start in production
// without them; supply them so the verifier is constructed rather than skipped.
vi.mock('@project-signal/config', () => ({
  getEnv: () => ({
    NODE_ENV: 'development',
    COGNITO_USER_POOL_ID: 'eu-west-2_test',
    COGNITO_CLIENT_ID: 'test-client-id',
  }),
}));

async function buildAuthApp() {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  const { default: authPlugin } = await import('../../src/plugins/auth.js');
  await app.register(authPlugin);
  app.get('/protected', async (req) => ({ user: req.user }));
  await app.ready();
  return app;
}

/** Builds an app with a stubbed `request.user` and requireBrandAccess on a `/brands/:id` route. */
async function buildBrandGuardApp(user: {
  role: 'owner' | 'admin' | 'user';
  brandEntityId?: string;
}) {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  const { requireBrandAccess } = await import('../../src/plugins/auth.js');

  app.decorateRequest<UserClaims | null>('user', null);
  app.addHook('onRequest', async (req) => {
    (req as unknown as { user: UserClaims }).user = { uid: 'u', tenantId: 'tenant-1', ...user };
  });
  app.get('/brands/:id/signals', { preHandler: requireBrandAccess }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('requireBrandAccess', () => {
  it('allows a pinned user to reach their own brand', async () => {
    const app = await buildBrandGuardApp({ role: 'user', brandEntityId: 'brand-1' });
    const res = await app.inject({ method: 'GET', url: '/brands/brand-1/signals' });
    expect(res.statusCode).toBe(200);
  });

  it('forbids a pinned user from reaching another brand', async () => {
    const app = await buildBrandGuardApp({ role: 'user', brandEntityId: 'brand-1' });
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/signals' });
    expect(res.statusCode).toBe(403);
  });

  // Matches GET /brands, which returns every brand in the tenant when no pin is set.
  it('does not constrain an unpinned user', async () => {
    const app = await buildBrandGuardApp({ role: 'user' });
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/signals' });
    expect(res.statusCode).toBe(200);
  });

  it.each(['owner', 'admin'] as const)('does not constrain %s', async (role) => {
    const app = await buildBrandGuardApp({ role, brandEntityId: 'brand-1' });
    const res = await app.inject({ method: 'GET', url: '/brands/brand-2/signals' });
    expect(res.statusCode).toBe(200);
  });
});

describe('auth plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['NODE_ENV'] = 'development';
  });

  it('allows public routes without a token', async () => {
    const app = await buildAuthApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(404); // Not registered, but auth didn't block it
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = await buildAuthApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when token format is not Bearer', async () => {
    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic sometoken' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('parses dev token (dev:role:tenantId) in development mode', async () => {
    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer dev:owner:tenant-42' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe('owner');
    expect(body.user.tenantId).toBe('tenant-42');
    expect(body.user.brandEntityId).toBeUndefined();
  });

  it('parses dev token with brandEntityId', async () => {
    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer dev:user:tenant-99:brand-55' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe('user');
    expect(body.user.tenantId).toBe('tenant-99');
    expect(body.user.brandEntityId).toBe('brand-55');
  });

  // Regression: ids are UUIDs, which contain hyphens. A hyphen-delimited dev token
  // truncated them at the first segment, so every tenant-scoped query matched nothing.
  it('preserves full UUIDs in tenantId and brandEntityId', async () => {
    const tenantId = '81a723d8-9026-45e3-b042-ffdf67492534';
    const brandEntityId = '08d1e5d2-c9ce-40e2-94b6-8328c975216e';
    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer dev:owner:${tenantId}:${brandEntityId}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.tenantId).toBe(tenantId);
    expect(body.user.brandEntityId).toBe(brandEntityId);
  });

  it('maps Cognito custom attributes onto request.user', async () => {
    process.env['NODE_ENV'] = 'production';
    // Cognito prefixes custom attributes with `custom:` and that prefix cannot be configured
    // away, so the plugin strips it. The rest of the codebase reads `tenantId`.
    mockVerifyIdToken.mockResolvedValue({
      sub: 'cognito-sub',
      'custom:tenantId': 'tenant-prod',
      'custom:role': 'admin',
      'custom:brandEntityId': '',
    });

    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer real-cognito-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.uid).toBe('cognito-sub');
    expect(body.user.tenantId).toBe('tenant-prod');
    // An empty attribute must become undefined, not ''. requireBrandAccess treats a falsy pin as
    // tenant-wide access; an empty string would compare unequal to every brand id and lock the
    // user out of everything they are entitled to see.
    expect(body.user.brandEntityId).toBeUndefined();
    expect(mockVerifyIdToken).toHaveBeenCalledWith('real-cognito-token');
  });

  it('returns 401 when the token verifies but carries no tenant or role', async () => {
    process.env['NODE_ENV'] = 'production';
    // A real, correctly signed token from a user who exists in the pool but was never
    // provisioned by the API. Defaulting a role here would grant access on the strength of a
    // signature alone.
    mockVerifyIdToken.mockResolvedValue({ sub: 'cognito-sub' });

    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer unprovisioned-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when token verification fails', async () => {
    process.env['NODE_ENV'] = 'production';
    mockVerifyIdToken.mockRejectedValue(new Error('Token expired'));

    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer expired-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('requireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['NODE_ENV'] = 'development';
  });

  it('allows request when user has the required role', async () => {
    const app = Fastify({ logger: false });
    await app.register(sensible);
    const { default: authPlugin, requireRole } = await import('../../src/plugins/auth.js');
    await app.register(authPlugin);
    app.get('/admin', { preHandler: requireRole('admin') }, async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: 'Bearer dev:admin:tenant-1' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 when user role is not in the allowed list', async () => {
    const app = Fastify({ logger: false });
    await app.register(sensible);
    const { default: authPlugin, requireRole } = await import('../../src/plugins/auth.js');
    await app.register(authPlugin);
    app.get('/owner-only', { preHandler: requireRole('owner') }, async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/owner-only',
      headers: { authorization: 'Bearer dev:user:tenant-1' },
    });
    expect(res.statusCode).toBe(403);
  });
});
