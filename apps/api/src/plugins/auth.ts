import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { getEnv } from '@project-signal/config';

export type UserRole = 'owner' | 'admin' | 'user';

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

const DEV_TOKEN_PREFIX = 'dev:';
const PUBLIC_ROUTE_PREFIXES = ['/health', '/ready', '/docs'];
const USER_KEY = Symbol('user');

/**
 * Cognito custom attributes arrive on the ID token prefixed with `custom:`. The prefix is added
 * by Cognito and cannot be configured away, so it is stripped here rather than leaking into
 * `UserClaims` — the rest of the codebase reads `tenantId`, not `custom:tenantId`.
 */
const CLAIM_TENANT = 'custom:tenantId';
const CLAIM_ROLE = 'custom:role';
const CLAIM_BRAND = 'custom:brandEntityId';

/**
 * Parse a development-only token of the form `dev:<role>:<tenantId>[:<brandEntityId>]`.
 *
 * The delimiter is `:` rather than `-` precisely because tenant and brand ids are UUIDs,
 * which contain hyphens — a hyphen-delimited token silently truncated the id at its first
 * segment, producing a tenantId that matched no rows.
 */
function parseDevToken(token: string): UserClaims {
  const [role, tenantId, brandEntityId] = token.slice(DEV_TOKEN_PREFIX.length).split(':');
  return {
    uid: `dev-uid-${tenantId ?? 'unknown'}`,
    role: (role ?? 'user') as UserRole,
    tenantId: tenantId ?? 'unknown',
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

  // Built once at plugin registration, not per request: the verifier caches the JWKS, and
  // constructing it per request would fetch the key set on every call.
  const verifier =
    env.COGNITO_USER_POOL_ID && env.COGNITO_CLIENT_ID
      ? CognitoJwtVerifier.create({
          userPoolId: env.COGNITO_USER_POOL_ID,
          clientId: env.COGNITO_CLIENT_ID,
          tokenUse: 'id',
        })
      : null;

  if (!verifier && env.NODE_ENV === 'production') {
    // Fail at boot rather than 401-ing every request in a way that looks like a client problem.
    throw new Error(
      'COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required in production — no identity ' +
        'provider is configured, so no request could ever be authorised.',
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
    const isPublic = PUBLIC_ROUTE_PREFIXES.some((p) => request.url.startsWith(p));
    if (isPublic) return;

    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.unauthorized('Missing Bearer token');
    }
    const token = auth.slice(7);

    if (env.NODE_ENV === 'development' && token.startsWith(DEV_TOKEN_PREFIX)) {
      request.user = parseDevToken(token);
      return;
    }

    if (!verifier) {
      return reply.unauthorized('Invalid token');
    }

    try {
      const payload = await verifier.verify(token);

      const tenantId = payload[CLAIM_TENANT];
      const role = payload[CLAIM_ROLE];

      // A validly signed token from a user who has not been provisioned carries no tenant or
      // role. Rejecting is the only safe reading: defaulting a role would grant access on the
      // strength of a signature alone.
      if (typeof tenantId !== 'string' || typeof role !== 'string') {
        return reply.unauthorized('Token is missing tenant or role claims');
      }

      const brandEntityId = payload[CLAIM_BRAND];

      request.user = {
        uid: payload.sub,
        tenantId,
        role: role as UserRole,
        // An unpinned user must be `undefined`, not `''`. requireBrandAccess treats a falsy pin
        // as tenant-wide access, and an empty string would compare unequal to every brand id and
        // lock the user out of everything.
        brandEntityId: typeof brandEntityId === 'string' && brandEntityId ? brandEntityId : undefined,
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
