import { CognitoUserPool } from 'amazon-cognito-identity-js';

/**
 * Cognito web config, replacing the Firebase / Identity Platform client.
 *
 * These values are public by design — the pool id is an identifier and the client id is a
 * PUBLIC OAuth client with no secret, because a browser cannot keep one. They are deliberately
 * NOT defaulted: `NEXT_PUBLIC_*` variables are inlined at build time, so a missing value would
 * silently produce a bundle pointed at the wrong user pool. Failing loudly at startup is the
 * lesser evil, and is the same choice the Firebase config made for the same reason.
 *
 * Set these in `apps/web/.env.local` locally, and as Docker build args in CI — a runtime
 * environment variable cannot reach the client bundle (KNOWN-GAPS #8).
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in apps/web/.env.local (local) or as a build arg (CI). ` +
        `Get the values from \`terraform -chdir=infra-aws/stack output\`.`,
    );
  }
  return value;
}

export const userPool = new CognitoUserPool({
  UserPoolId: required(
    'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  ),
  ClientId: required('NEXT_PUBLIC_COGNITO_CLIENT_ID', process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID),
});
