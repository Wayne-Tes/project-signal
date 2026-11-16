/**
 * Build-time configuration for the web client.
 *
 * Every `NEXT_PUBLIC_*` value is INLINED by `next build` — each must be referenced by its full
 * literal name (`process.env.NEXT_PUBLIC_X`) for the replacement to happen, and a runtime
 * environment variable can never reach the browser bundle (KNOWN-GAPS #8). They live in one
 * module so that rule is applied in one place.
 */

export type AuthMode = 'cognito' | 'local';

/**
 * Which identity provider the app signs in against.
 *
 * - `cognito` (default): the real pool. Every deployed build.
 * - `local`: the API's local-development sign-in (`POST /auth/local/sign-in`), which exists only
 *   when the API itself runs with `AUTH_MODE=local` and refuses to boot that way in production.
 *   It lets the whole product — sign-in, roles, every view — run on a laptop with no cloud.
 *
 * Anything other than the exact string `local` is Cognito. A typo must fail towards the real
 * provider, never towards the development one.
 */
export const AUTH_MODE: AuthMode =
  process.env.NEXT_PUBLIC_AUTH_MODE === 'local' ? 'local' : 'cognito';

/**
 * Base URL of the API.
 *
 * On AWS the web app and the API sit behind the SAME load balancer, so this is the ALB's own
 * origin — same-origin, no CORS preflight. Locally the API runs on its own port (9080 on the
 * owner's machine; see README "Local ports"), set in `apps/web/.env.local`.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
