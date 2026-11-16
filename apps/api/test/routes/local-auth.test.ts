import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { httpBasics } from '../../src/lib/http.js';

const mockEnv = vi.hoisted(() => ({ value: {} as Record<string, string | undefined> }));
vi.mock('@project-signal/config', () => ({ getEnv: () => mockEnv.value }));

let _rows: unknown[] = [];
const _where: unknown[] = [];
vi.mock('@project-signal/db', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'limit']) chain[m] = vi.fn(() => chain);
  chain['where'] = vi.fn((w: unknown) => {
    _where.push(w);
    return chain;
  });
  chain['then'] = (r: unknown, j?: unknown) => Promise.resolve(_rows).then(r as never, j as never);
  return {
    db: { get: vi.fn(() => chain) },
    users: {
      firebaseUid: 'firebase_uid',
      role: 'role',
      tenantId: 'tenant_id',
      brandEntityId: 'brand_entity_id',
    },
  };
});

const { localAuthRoutes, passwordMatches } = await import('../../src/routes/local-auth.js');
const { parseDevToken } = await import('../../src/plugins/auth.js');

const PASSWORD = 'a-local-password-for-tests';
const TENANT = '11111111-1111-4111-8111-111111111111';
const BRAND = 'b1111111-1111-4111-8111-111111111111';

async function build() {
  const app = Fastify({ logger: false });
  await app.register(httpBasics);
  await app.register(localAuthRoutes);
  await app.ready();
  return app;
}

function signIn(app: Awaited<ReturnType<typeof build>>, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/auth/local/sign-in', payload });
}

beforeEach(() => {
  vi.clearAllMocks();
  _rows = [];
  _where.length = 0;
  mockEnv.value = { AUTH_MODE: 'local', LOCAL_AUTH_PASSWORD: PASSWORD, NODE_ENV: 'development' };
});

describe('POST /auth/local/sign-in', () => {
  it('DOES NOT EXIST outside local mode', async () => {
    /* In Cognito mode — every deployed environment — the route is never registered, so it cannot
       be probed, brute-forced or reached by a misconfiguration. */
    mockEnv.value = { AUTH_MODE: 'cognito', LOCAL_AUTH_PASSWORD: PASSWORD };
    const app = await build();
    const res = await signIn(app, { username: 'local-owner', password: PASSWORD });
    expect(res.statusCode).toBe(404);
  });

  it("issues a token carrying the user row's role, tenant and pin", async () => {
    _rows = [{ firebaseUid: 'local-user', role: 'user', tenantId: TENANT, brandEntityId: BRAND }];
    const app = await build();
    const res = await signIn(app, { username: 'local-user', password: PASSWORD });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user).toEqual({
      username: 'local-user',
      role: 'user',
      tenantId: TENANT,
      brandEntityId: BRAND,
    });
    // The token is exactly what the auth plugin parses into request.user — same claim shape as
    // a Cognito ID token, so requireRole / requireBrandAccess behave identically.
    expect(parseDevToken(body.token)).toEqual({
      uid: 'local-user',
      role: 'user',
      tenantId: TENANT,
      brandEntityId: BRAND,
    });
  });

  it('issues an unpinned token for an unpinned user', async () => {
    _rows = [{ firebaseUid: 'local-owner', role: 'owner', tenantId: TENANT, brandEntityId: null }];
    const app = await build();
    const body = JSON.parse(
      (await signIn(app, { username: 'local-owner', password: PASSWORD })).body,
    );
    expect(parseDevToken(body.token)).toMatchObject({
      uid: 'local-owner',
      brandEntityId: undefined,
    });
  });

  it('looks the user up by username (users.firebase_uid)', async () => {
    _rows = [{ firebaseUid: 'local-admin', role: 'admin', tenantId: TENANT, brandEntityId: null }];
    const app = await build();
    await signIn(app, { username: 'local-admin', password: PASSWORD });
    expect(JSON.stringify(_where)).toContain('local-admin');
  });

  it('refuses a wrong password with a generic 401', async () => {
    _rows = [{ firebaseUid: 'local-owner', role: 'owner', tenantId: TENANT, brandEntityId: null }];
    const app = await build();
    const res = await signIn(app, { username: 'local-owner', password: 'wrong-password' });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('token');
  });

  it('gives an unknown user the SAME answer as a wrong password', async () => {
    /* Otherwise the endpoint is an oracle for which usernames exist. */
    _rows = [];
    const app = await build();
    const unknown = await signIn(app, { username: 'nobody', password: PASSWORD });
    _rows = [{ firebaseUid: 'local-owner', role: 'owner', tenantId: TENANT, brandEntityId: null }];
    const wrong = await signIn(app, { username: 'local-owner', password: 'nope-nope-nope' });

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(JSON.parse(unknown.body).message).toBe(JSON.parse(wrong.body).message);
  });

  it('refuses a row whose role is not one the system knows', async () => {
    _rows = [{ firebaseUid: 'odd', role: 'superuser', tenantId: TENANT, brandEntityId: null }];
    const app = await build();
    expect((await signIn(app, { username: 'odd', password: PASSWORD })).statusCode).toBe(401);
  });

  it.each([
    ['a username containing the token delimiter', { username: 'a:b', password: PASSWORD }],
    ['a missing password', { username: 'local-owner' }],
    ['an extra field', { username: 'local-owner', password: PASSWORD, role: 'owner' }],
  ])('validates the body: %s', async (_label, payload) => {
    _rows = [{ firebaseUid: 'local-owner', role: 'owner', tenantId: TENANT, brandEntityId: null }];
    const app = await build();
    const res = await signIn(app, payload);
    // The extra field is stripped (not a 400) — what matters is it cannot choose the role.
    if ('role' in payload) {
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).user.role).toBe('owner');
    } else {
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('passwordMatches', () => {
  it('compares in constant time over any lengths', () => {
    expect(passwordMatches('abc', 'abc')).toBe(true);
    expect(passwordMatches('abc', 'abd')).toBe(false);
    expect(passwordMatches('short', 'a-much-longer-expected-value')).toBe(false);
    expect(passwordMatches('', '')).toBe(true);
  });
});
