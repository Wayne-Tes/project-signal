import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import admin from 'firebase-admin';

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

const authPlugin: FastifyPluginAsync = async (fastify) => {
  if (!admin.apps.length) {
    admin.initializeApp();
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

    if (process.env['NODE_ENV'] === 'development' && token.startsWith(DEV_TOKEN_PREFIX)) {
      request.user = parseDevToken(token);
      return;
    }

    try {
      const decoded = await admin.auth().verifyIdToken(token);
      request.user = {
        uid: decoded.uid,
        tenantId: decoded['tenantId'] as string,
        role: decoded['role'] as UserRole,
        brandEntityId: decoded['brandEntityId'] as string | undefined,
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
