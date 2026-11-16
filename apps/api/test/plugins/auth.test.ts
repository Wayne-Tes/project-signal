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

const COGNITO_ENV = {
  NODE_ENV: 'production',
  AUTH_MODE: 'cognito',
  COGNITO_USER_POOL_ID: 'eu-west-2_test',
  COGNITO_CLIENT_ID: 'test-client-id',
};
const LOCAL_ENV = {
  NODE_ENV: 'development',
  AUTH_MODE: 'local',
  LOCAL_AUTH_PASSWORD: 'a-local-password',
};

const mockEnv = vi.hoisted(() => ({ value: {} as Record<string, string | undefined> }));
vi.mock('@project-signal/config', () => ({ getEnv: () => mockEnv.value }));

const TENANT = '81a723d8-9026-45e3-b042-ffdf67492534';
const BRAND = '08d1e5d2-c9ce-40e2-94b6-8328c975216e';
const OTHER_BRAND = '5f0b8a51-1c55-4d52-9a1e-6a1c0e0b7b11';

async function buildAuthApp() {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  const { default: authPlugin } = await import('../../src/plugins/auth.js');
  await app.register(authPlugin);
  app.get('/protected', async (req) => ({ user: req.user }));
  app.get('/health', async () => ({ ok: true }));
  app.get('/healthcheck-admin', async () => ({ ok: true }));
  app.get('/docs/json', async () => ({ ok: true }));
  app.get('/docsets', async () => ({ ok: true }));
  app.post('/auth/local/sign-in', async () => ({ ok: true }));
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
    (req as unknown as { user: UserClaims }).user = { uid: 'u', tenantId: TENANT, ...user };
  });
  app.get('/brands/:id/signals', { preHandler: requireBrandAccess }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('requireBrandAccess', () => {
  it('allows a pinned user to reach their own brand', async () => {
    const app = await buildBrandGuardApp({ role: 'user', brandEntityId: BRAND });
    const res = await app.inject({ method: 'GET', url: `/brands/${BRAND}/signals` });
    expect(res.statusCode).toBe(200);
  });

  it('forbids a pinned user from reaching another brand', async () => {
    const app = await buildBrandGuardApp({ role: 'user', brandEntityId: BRAND });
    const res = await app.inject({ method: 'GET', url: `/brands/${OTHER_BRAND}/signals` });
    expect(res.statusCode).toBe(403);
  });

  // Matches GET /brands, which returns every brand in the tenant when no pin is set.
  it('does not constrain an unpinned user', async () => {
    const app = await buildBrandGuardApp({ role: 'user' });
    const res = await app.inject({ method: 'GET', url: `/brands/${OTHER_BRAND}/signals` });
    expect(res.statusCode).toBe(200);
  });

  it.each(['owner', 'admin'] as const)('does not constrain %s', async (role) => {
    const app = await buildBrandGuardApp({ role, brandEntityId: BRAND });
    const res = await app.inject({ method: 'GET', url: `/brands/${OTHER_BRAND}/signals` });
    expect(res.statusCode).toBe(200);
  });
});

describe('isPublicPath', () => {
  it('matches only the exact public paths, never a shared prefix', async () => {
    const { isPublicPath } = await import('../../src/plugins/auth.js');
    expect(isPublicPath('/health', false)).toBe(true);
    expect(isPublicPath('/ready?x=1', false)).toBe(true);
    expect(isPublicPath('/docs', false)).toBe(true);
    expect(isPublicPath('/docs/static/index.html', false)).toBe(true);
    expect(isPublicPath('/healthcheck-admin', false)).toBe(false);
    expect(isPublicPath('/readyz', false)).toBe(false);
    expect(isPublicPath('/docsets', false)).toBe(false);
    expect(isPublicPath('/brands', false)).toBe(false);
  });

  it('makes local sign-in public only in local mode', async () => {
    const { isPublicPath } = await import('../../src/plugins/auth.js');
    expect(isPublicPath('/auth/local/sign-in', true)).toBe(true);
    expect(isPublicPath('/auth/local/sign-in', false)).toBe(false);
  });
});

describe('dev tokens', () => {
  it('round-trips every shape through devToken / parseDevToken', async () => {
    const { devToken, parseDevToken } = await import('../../src/plugins/auth.js');
    expect(parseDevToken(devToken({ role: 'owner', tenantId: TENANT }))).toEqual({
      uid: `dev-uid-${TENANT}`,
      role: 'owner',
      tenantId: TENANT,
      brandEntityId: undefined,
    });
    expect(
      parseDevToken(devToken({ role: 'user', tenantId: TENANT, brandEntityId: BRAND })),
    ).toEqual({
      uid: `dev-uid-${TENANT}`,
      role: 'user',
      tenantId: TENANT,
      brandEntityId: BRAND,
    });
    expect(
      parseDevToken(
        devToken({ role: 'admin', tenantId: TENANT, brandEntityId: null, uid: 'local-admin' }),
      ),
    ).toEqual({ uid: 'local-admin', role: 'admin', tenantId: TENANT, brandEntityId: undefined });
    expect(
      parseDevToken(
        devToken({ role: 'user', tenantId: TENANT, brandEntityId: BRAND, uid: 'local-user' }),
      ),
    ).toEqual({ uid: 'local-user', role: 'user', tenantId: TENANT, brandEntityId: BRAND });
  });

  it('rejects an unknown role, a non-uuid tenant or a non-uuid brand', async () => {
    const { parseDevToken } = await import('../../src/plugins/auth.js');
    expect(parseDevToken(`dev:superuser:${TENANT}`)).toBeNull();
    expect(parseDevToken('dev:owner:tenant-1')).toBeNull();
    expect(parseDevToken('dev:owner')).toBeNull();
    expect(parseDevToken(`dev:user:${TENANT}:not-a-uuid`)).toBeNull();
  });
});

describe('auth plugin — local mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.value = { ...LOCAL_ENV };
  });

  it('accepts a well-formed dev token', async () => {
    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: bearer(`dev:user:${TENANT}:${BRAND}`),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).user).toEqual({
      uid: `dev-uid-${TENANT}`,
      role: 'user',
      tenantId: TENANT,
      brandEntityId: BRAND,
    });
  });

  it('rejects a malformed dev token', async () => {
    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: bearer(`dev:superuser:${TENANT}`),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects anything that is not a dev token, and never calls Cognito', async () => {
    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: bearer('eyJ.real.jwt'),
    });
    expect(res.statusCode).toBe(401);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('boots with no Cognito configuration at all', async () => {
    const app = await buildAuthApp();
    expect(app).toBeTruthy();
  });

  it('leaves the local sign-in path public', async () => {
    const app = await buildAuthApp();
    const res = await app.inject({ method: 'POST', url: '/auth/local/sign-in' });
    expect(res.statusCode).toBe(200);
  });
});

describe('auth plugin — Cognito mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.value = { ...COGNITO_ENV };
  });

  it('allows public routes without a token, and only those', async () => {
    const app = await buildAuthApp();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(200);
    // Shared prefixes used to be public by accident.
    expect((await app.inject({ method: 'GET', url: '/healthcheck-admin' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/docsets' })).statusCode).toBe(401);
    // The local sign-in path is NOT public outside local mode.
    expect((await app.inject({ method: 'POST', url: '/auth/local/sign-in' })).statusCode).toBe(401);
  });

  it('refuses to boot without a pool, whatever NODE_ENV says', async () => {
    // Previously only production refused; a process started with no NODE_ENV fell through to
    // "development" and accepted unsigned tokens.
    mockEnv.value = { NODE_ENV: 'development', AUTH_MODE: 'cognito' };
    await expect(buildAuthApp()).rejects.toThrow(/AUTH_MODE=cognito/);
  });

  it('REJECTS a dev token — unsigned tokens exist only in local mode', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('not a JWT'));
    mockEnv.value = { ...COGNITO_ENV, NODE_ENV: 'development' };
    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: bearer(`dev:owner:${TENANT}`),
    });
    expect(res.statusCode).toBe(401);
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

  it('maps Cognito custom attributes onto request.user', async () => {
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
      headers: bearer('real-cognito-token'),
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

  it('returns 401 when the token verifies but carries no role', async () => {
    // A real, correctly signed token from a user who exists in the pool but was never
    // provisioned by the API. Defaulting a role here would grant access on the strength of a
    // signature alone.
    mockVerifyIdToken.mockResolvedValue({ sub: 'cognito-sub' });

    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: bearer('unprovisioned-token'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a role the system does not know', async () => {
    // requireBrandAccess constrains only the literal 'user', so an unknown role string would
    // otherwise pass as unconstrained.
    mockVerifyIdToken.mockResolvedValue({
      sub: 'cognito-sub',
      'custom:role': 'superuser',
      'custom:tenantId': TENANT,
    });
    const app = await buildAuthApp();
    const res = await app.inject({ method: 'GET', url: '/protected', headers: bearer('t') });
    expect(res.statusCode).toBe(401);
  });

  it('admits a tenant-less OWNER, because that is the bootstrap state', async () => {
    // bootstrap-owner.ts sets role and deliberately no tenant: POST /admin/tenants creates the
    // tenant and the claims together. Rejecting this deadlocked a fresh environment — the first
    // owner was 401'd on the one endpoint that could give them a tenant.
    mockVerifyIdToken.mockResolvedValue({ sub: 'cognito-sub', 'custom:role': 'owner' });

    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: bearer('bootstrap-owner-token'),
    });
    expect(res.statusCode).toBe(200);
    // A VALID uuid, not the empty string. tenant_id is a uuid column and Postgres rejects '' as
    // a type error, so an empty string turned every tenant-scoped read into a 500 instead of an
    // empty list. The nil uuid matches no row, which is the behaviour actually wanted.
    expect(JSON.parse(res.body).user.tenantId).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('rejects a tenant-less admin or user — only owner may bootstrap', async () => {
    for (const role of ['admin', 'user']) {
      mockVerifyIdToken.mockResolvedValue({ sub: 'cognito-sub', 'custom:role': role });
      const app = await buildAuthApp();
      const res = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: bearer('tenantless-token'),
      });
      expect(res.statusCode, `role=${role} must be rejected without a tenant`).toBe(401);
    }
  });

  it('returns 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Token expired'));

    const app = await buildAuthApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: bearer('expired-token'),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('requireRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.value = { ...LOCAL_ENV };
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
      headers: bearer(`dev:admin:${TENANT}`),
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
      headers: bearer(`dev:user:${TENANT}`),
    });
    expect(res.statusCode).toBe(403);
  });
});
