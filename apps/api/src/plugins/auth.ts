import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { getEnv } from '@project-signal/config';

export const USER_ROLES = ['owner', 'admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UserClaims = {
  uid: string;
  tenantId: string;
  role: UserRole;
  brandEntityId?: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    user: UserClaims;
  }
}

export const DEV_TOKEN_PREFIX = 'dev:';
const USER_KEY = Symbol('user');

/** The one route that is public in local mode: it is how a local session starts. */
export const LOCAL_SIGN_IN_PATH = '/auth/local/sign-in';

/**
 * Is this request path public?
 *
 * Matched on the PATH ONLY (query string removed) and exactly: `/health`, `/ready`, and `/docs`
 * or anything beneath `/docs/`. This used to be `url.startsWith('/health')` and so on — which
 * also made `/healthcheck-admin`, `/readyz`, `/docsets` or any future route sharing a prefix
 * unauthenticated by accident. Nothing collided yet; that is exactly when to close it.
 */
export function isPublicPath(url: string, localMode: boolean): boolean {
  const path = url.split('?')[0] ?? '';
  if (path === '/health' || path === '/ready') return true;
  if (path === '/docs' || path.startsWith('/docs/')) return true;
  return localMode && path === LOCAL_SIGN_IN_PATH;
}

/**
 * Cognito custom attributes arrive on the ID token prefixed with `custom:`. The prefix is added
 * by Cognito and cannot be configured away, so it is stripped here rather than leaking into
 * `UserClaims` — the rest of the codebase reads `tenantId`, not `custom:tenantId`.
 */
const CLAIM_TENANT = 'custom:tenantId';
const CLAIM_ROLE = 'custom:role';
const CLAIM_BRAND = 'custom:brandEntityId';

/**
 * Stand-in tenant for a bootstrap owner who has no tenant yet.
 *
 * It must be a SYNTACTICALLY VALID uuid, not the empty string. `tenant_id` is a `uuid` column,
 * and Postgres rejects `''` as a type error rather than treating it as a value that matches
 * nothing — so an empty string turned every tenant-scoped read into a 500 rather than an empty
 * list. Found by calling GET /brands as a real bootstrap owner against the deployed API.
 *
 * The nil uuid is valid, is guaranteed not to collide with `gen_random_uuid()`, and matches no
 * row — which is the intended behaviour: a tenant-less owner can see nothing until they create
 * a tenant.
 */
const NO_TENANT = '00000000-0000-0000-0000-000000000000';

/**
 * Builds a local-mode token: `dev:<role>:<tenantId>[:<brandEntityId>][:<uid>]`.
 *
 * The delimiter is `:` rather than `-` precisely because tenant and brand ids are UUIDs, which
 * contain hyphens — a hyphen-delimited token silently truncated the id at its first segment.
 * The optional trailing uid lets a local session keep a stable identity (conversations are
 * stored per uid); an empty brand segment means "unpinned".
 */
export function devToken(claims: {
  role: UserRole;
  tenantId: string;
  brandEntityId?: string | null;
  uid?: string;
}): string {
  const parts = [claims.role, claims.tenantId, claims.brandEntityId ?? ''];
  if (claims.uid) parts.push(claims.uid);
  else if (!claims.brandEntityId) parts.pop();
  return `${DEV_TOKEN_PREFIX}${parts.join(':')}`;
}

/**
 * Parses a local-mode token, or returns null if it is malformed.
 *
 * Strict, because the token is unsigned: the role must be one of the three, and the tenant and
 * any brand pin must be uuids. The previous parser accepted anything — `dev:superuser:x` became a
 * request with role "superuser", which `requireBrandAccess` then treated as unconstrained because
 * it only constrains the literal `'user'`.
 */
export function parseDevToken(token: string): UserClaims | null {
  const [role, tenantId, brandEntityId, uid] = token.slice(DEV_TOKEN_PREFIX.length).split(':');
  if (!isUserRole(role) || !tenantId || !UUID_RE.test(tenantId)) return null;
  if (brandEntityId && !UUID_RE.test(brandEntityId)) return null;
  return {
    uid: uid || `dev-uid-${tenantId}`,
    role,
    tenantId,
    brandEntityId: brandEntityId || undefined,
  };
}

/**
 * Authentication on Amazon Cognito, replacing Firebase / GCP Identity Platform.
 *
 * **Authorisation reads the token's claims, never the `users` table.** That table is a directory
 * record for the admin UI; it is not consulted when authorising a request. The two diverging is
 * a security problem rather than an untidiness, which is why `lib/claims.ts` writes the claim
 * inside the same database transaction as the row (KNOWN-GAPS #18).
 *
 * `CognitoJwtVerifier` fetches and caches the pool's JWKS, and verifies the signature, issuer,
 * audience, token use and expiry. Rolling our own with a generic JWT library is how the
 * `tokenUse` check gets forgotten — an ACCESS token and an ID token are both validly signed by
 * the same pool, but only the ID token carries the custom attributes this system authorises on.
 */
const authPlugin: FastifyPluginAsync = async (fastify) => {
  const env = getEnv();
  /* Local mode is an explicit opt-in (AUTH_MODE=local), never inferred from NODE_ENV. It used to
     be `NODE_ENV === 'development'` — the schema's DEFAULT — so any process started without
     NODE_ENV accepted unsigned tokens naming any tenant and any role. libs/config refuses
     AUTH_MODE=local outright when NODE_ENV=production. */
  const localMode = env.AUTH_MODE === 'local';

  // Built once at plugin registration, not per request: the verifier caches the JWKS, and
  // constructing it per request would fetch the key set on every call. Not built at all in local
  // mode, where no Cognito token is ever accepted.
  const verifier =
    !localMode && env.COGNITO_USER_POOL_ID && env.COGNITO_CLIENT_ID
      ? CognitoJwtVerifier.create({
          userPoolId: env.COGNITO_USER_POOL_ID,
          clientId: env.COGNITO_CLIENT_ID,
          tokenUse: 'id',
        })
      : null;

  if (!localMode && !verifier) {
    // Fail at boot rather than 401-ing every request in a way that looks like a client problem.
    throw new Error(
      'COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required when AUTH_MODE=cognito — no ' +
        'identity provider is configured, so no request could ever be authorised. For a ' +
        'developer machine with no identity provider, set AUTH_MODE=local.',
    );
  }

  fastify.decorateRequest<UserClaims>('user', {
    getter(this: FastifyRequest) {
      return (this as unknown as Record<symbol, UserClaims>)[USER_KEY] as UserClaims;
    },
    setter(this: FastifyRequest, value: UserClaims) {
      (this as unknown as Record<symbol, UserClaims>)[USER_KEY] = value;
    },
  });

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublicPath(request.url, localMode)) return;

    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.unauthorized('Missing Bearer token');
    }
    const token = auth.slice(7);

    if (localMode) {
      const claims = token.startsWith(DEV_TOKEN_PREFIX) ? parseDevToken(token) : null;
      if (!claims) return reply.unauthorized('Invalid token');
      request.user = claims;
      return;
    }

    if (!verifier) {
      return reply.unauthorized('Invalid token');
    }

    try {
      const payload = await verifier.verify(token);

      const tenantId = payload[CLAIM_TENANT];
      const role = payload[CLAIM_ROLE];

      // A validly signed token from a user who has not been provisioned carries no role.
      // Rejecting is the only safe reading: defaulting one would grant access on the strength
      // of a signature alone.
      if (typeof role !== 'string') {
        return reply.unauthorized('Token is missing the role claim');
      }
      /* And it must be one of the three. `requireBrandAccess` constrains only the literal
         `'user'`, so an unrecognised role string — a typo in a Cognito attribute, or a role this
         code has never heard of — would otherwise be treated as unconstrained. */
      if (!isUserRole(role)) {
        return reply.unauthorized('Token carries an unrecognised role');
      }

      const hasTenant = typeof tenantId === 'string' && tenantId !== '';

      // ── The bootstrap owner is the one legitimate tenant-less identity ────────────────────
      //
      // scripts/bootstrap-owner.ts sets `custom:role = owner` and deliberately NO tenant,
      // because POST /admin/tenants creates the tenant and writes the claims in one
      // transaction — pre-seeding a tenant id would produce a claim pointing at nothing.
      //
      // Requiring a tenant from everyone therefore deadlocked the system: the first owner was
      // 401'd on the very endpoint that would have given them a tenant, so a fresh environment
      // could never be bootstrapped at all. Found by signing in as a real bootstrap owner.
      //
      // Allowing it is safe rather than a hole. `tenantId` falls through as NO_TENANT, and
      // every query in this codebase filters on `tenant_id` — the nil uuid matches no row, so a
      // tenant-less owner can see nothing. The only thing they can usefully do is create a
      // tenant, which is exactly the intent. Any other role without a tenant is still rejected.
      if (!hasTenant && role !== 'owner') {
        return reply.unauthorized('Token is missing the tenant claim');
      }

      const brandEntityId = payload[CLAIM_BRAND];

      request.user = {
        uid: payload.sub,
        tenantId: hasTenant ? tenantId : NO_TENANT,
        role,
        // An unpinned user must be `undefined`, not `''`. requireBrandAccess treats a falsy pin
        // as tenant-wide access, and an empty string would compare unequal to every brand id and
        // lock the user out of everything.
        brandEntityId:
          typeof brandEntityId === 'string' && brandEntityId ? brandEntityId : undefined,
      };
    } catch {
      return reply.unauthorized('Invalid token');
    }
  });
};

export const requireRole =
  (...roles: UserRole[]) =>
  async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.user.role)) {
      return reply.forbidden('Insufficient role');
    }
  };

/**
 * Guard for `/brands/:id/*` routes: a `user` pinned to a brand may only read that brand.
 *
 * Cross-tenant isolation is enforced by the `tenant_id` filter in every query; this closes
 * the intra-tenant hole, where changing `:id` in the URL exposed a sibling brand — including
 * competitors tracked by the same tenant.
 *
 * An unpinned `user` (no `brandEntityId` claim) is deliberately NOT constrained here, which
 * matches `GET /brands`: that route filters to the pinned brand only when the claim is set,
 * and otherwise returns every brand in the tenant. Both routes therefore treat "no pin" as
 * tenant-wide read access. `owner` and `admin` are never constrained.
 */
export const requireBrandAccess = async (request: FastifyRequest, reply: FastifyReply) => {
  const { id } = request.params as { id?: string };
  const { role, brandEntityId } = request.user;

  if (role === 'user' && brandEntityId && brandEntityId !== id) {
    return reply.forbidden('Brand access denied');
  }
};

export default fp(authPlugin);
