import { timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { db, users } from '@project-signal/db';
import { getEnv } from '@project-signal/config';
import { eq } from 'drizzle-orm';
import { devToken, isUserRole, LOCAL_SIGN_IN_PATH } from '../plugins/auth.js';

/**
 * Local sign-in — a developer machine's stand-in for Cognito.
 *
 * REGISTERED ONLY WHEN AUTH_MODE=local, which libs/config refuses in production. In the default
 * (Cognito) mode this route does not exist, so it cannot be probed, brute-forced or mis-deployed.
 *
 * ## What it does
 *
 * Given a username and the shared LOCAL_AUTH_PASSWORD, it finds the `users` row whose
 * `cognito_sub` is that username and returns a `dev:` token carrying that row's role, tenant and
 * brand pin — the same three claims a Cognito ID token carries, so `requireRole` and
 * `requireBrandAccess` behave exactly as they do in a deployed environment. The `users` row is the
 * claim source here because there is no identity provider to hold the claims; in Cognito mode the
 * provider is the source and the row is only a mirror (lib/claims.ts).
 *
 * ## Why a shared password rather than per-user ones
 *
 * The `users` table has no credential column, deliberately: in every real environment Cognito
 * owns credentials. Adding one for local use would put a password store in the production schema.
 * One developer-machine password, in `.env`, gates every seeded local identity — enough to make a
 * local session a deliberate act without building an identity provider.
 */

const BODY = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: {
    /* A Cognito `sub` (uuid) or a local username like `local-owner`. ':' is excluded because it
       is the token's delimiter. */
    username: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._@+-]+$' },
    password: { type: 'string', minLength: 1, maxLength: 256 },
  },
} as const;

/** Constant-time comparison of two strings of any length (hashing first equalises length). */
export function passwordMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export const localAuthRoutes: FastifyPluginAsync = async (fastify) => {
  const env = getEnv();
  if (env.AUTH_MODE !== 'local') return;
  const expected = env.LOCAL_AUTH_PASSWORD ?? '';

  fastify.post<{ Body: { username: string; password: string } }>(
    LOCAL_SIGN_IN_PATH,
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        description:
          'LOCAL DEVELOPMENT ONLY (AUTH_MODE=local). Exchanges a seeded username and the shared local password for a token carrying that user’s role, tenant and brand pin. Absent in Cognito mode.',
        body: BODY,
        response: {
          200: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  username: { type: 'string' },
                  role: { type: 'string' },
                  tenantId: { type: 'string' },
                  brandEntityId: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;

      /* Both checks always run, and every failure returns the same 401, so the response says
         nothing about whether the username exists. */
      const passwordOk = passwordMatches(password, expected);
      const [row] = await db
        .get()
        .select({
          cognitoSub: users.cognitoSub,
          role: users.role,
          tenantId: users.tenantId,
          brandEntityId: users.brandEntityId,
        })
        .from(users)
        .where(eq(users.cognitoSub, username))
        .limit(1);

      if (!passwordOk || !row || !isUserRole(row.role)) {
        return reply.unauthorized('Invalid username or password.');
      }

      return {
        token: devToken({
          role: row.role,
          tenantId: row.tenantId,
          brandEntityId: row.brandEntityId,
          uid: row.cognitoSub,
        }),
        user: {
          username: row.cognitoSub,
          role: row.role,
          tenantId: row.tenantId,
          brandEntityId: row.brandEntityId,
        },
      };
    },
  );
};

export default localAuthRoutes;
