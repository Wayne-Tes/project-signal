import { CognitoUserPool } from 'amazon-cognito-identity-js';

/**
 * Cognito web config.
 *
 * These values are public by design — the pool id is an identifier and the client id is a
 * PUBLIC OAuth client with no secret, because a browser cannot keep one. They are deliberately
 * NOT defaulted: `NEXT_PUBLIC_*` variables are inlined at build time, so a missing value would
 * silently produce a bundle pointed at the wrong user pool. Failing loudly is the lesser evil.
 *
 * Set these in `apps/web/.env.local` locally, and as Docker build args in CI — a runtime
 * environment variable cannot reach the client bundle (KNOWN-GAPS #8).
 *
 * TOKEN STORAGE — a known, accepted residual risk. The SDK keeps the ID, access and refresh
 * tokens in localStorage by default. Any script that runs in this origin can read them, so the
 * defence is to never let one run: every data-derived href goes through `lib/safe-url.ts`, the
 * markdown renderer emits React elements and never innerHTML, and the only `dangerouslySetInnerHTML`
 * is the constant appearance boot script. Moving to sessionStorage would not change what an
 * injected script can read in the same tab — it would only cost returning users their 30-day
 * session — and an httpOnly-cookie session needs a server-side token exchange this app does not
 * have. Revisit if that changes.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in apps/web/.env.local (local) or as a build arg (CI). ` +
        `Get the values from \`terraform -chdir=infra-aws/stack output\`, or set ` +
        `NEXT_PUBLIC_AUTH_MODE=local to use the API's local-development sign-in instead.`,
    );
  }
  return value;
}

let pool: CognitoUserPool | null = null;

/**
 * The pool, created on first use.
 *
 * LAZY ON PURPOSE. It used to be a module-level constant, so merely importing the auth module
 * threw when the Cognito variables were absent — which made a Cognito-free local build
 * impossible even though local mode never touches Cognito. Validation still happens, and still
 * fails loudly; it just happens when Cognito is actually used.
 */
export function getUserPool(): CognitoUserPool {
  if (!pool) {
    pool = new CognitoUserPool({
      UserPoolId: required(
        'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
        process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
      ),
      ClientId: required(
        'NEXT_PUBLIC_COGNITO_CLIENT_ID',
        process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
      ),
    });
  }
  return pool;
}
