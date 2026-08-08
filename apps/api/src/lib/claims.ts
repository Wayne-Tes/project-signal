import {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { getEnv } from '@project-signal/config';
import type { UserRole } from '../plugins/auth.js';

/**
 * The custom-attribute payload. Must stay in step with what `plugins/auth.ts` reads off the
 * verified token — these three fields *are* the authorisation model. The `users` table is a
 * directory record; it is not consulted when authorising a request.
 */
export interface UserClaims {
  role: UserRole;
  tenantId: string;
  brandEntityId?: string | null;
}

let _client: CognitoIdentityProviderClient | undefined;

/**
 * Lazily constructed, and region/credentials come from the SDK's default chain — the ECS task
 * role in a deployed environment. No code holds a key.
 */
function client(): CognitoIdentityProviderClient {
  if (!_client) {
    const endpoint = process.env['AWS_ENDPOINT_URL'];
    _client = new CognitoIdentityProviderClient(endpoint ? { endpoint } : {});
  }
  return _client;
}

/**
 * Sets a user's authorisation claims as Cognito custom attributes.
 *
 * **Always call this inside the database transaction that writes the matching `users` row.**
 * Because authorisation reads the token and not the table, the two diverging is a security
 * problem rather than a tidiness one: a demotion that updates the row but not the attribute
 * leaves the user holding their old access while the table says otherwise. Calling it inside
 * the transaction means a failure here rolls the row back and neither system moves.
 *
 * The residual window is a commit failure *after* this call succeeded, which leaves the
 * attribute ahead of the table. That cannot be closed without a distributed transaction; it is
 * logged by the caller and is the safer of the two directions, since the attribute is the value
 * actually enforced.
 *
 * Attributes take effect on the user's next token refresh — up to the ID token's 60-minute
 * lifetime, or immediately on re-authentication. This matches the Firebase behaviour it
 * replaces and is why the `users` table exists as a mirror at all.
 *
 * @param sub The Cognito subject id — the `sub` claim, stored as `users.firebase_uid`. The
 *            column keeps its historical name until a migration renames it; the value is the
 *            provider's stable subject either way.
 */
export async function setUserClaims(sub: string, claims: UserClaims): Promise<void> {
  const env = getEnv();
  if (!env.COGNITO_USER_POOL_ID) {
    throw new Error(
      'COGNITO_USER_POOL_ID is not set — cannot write authorisation claims. Refusing rather ' +
        'than writing a users row whose holder could never be authorised.',
    );
  }

  await client().send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: env.COGNITO_USER_POOL_ID,
      Username: sub,
      UserAttributes: [
        { Name: 'custom:role', Value: claims.role },
        { Name: 'custom:tenantId', Value: claims.tenantId },
        // Cognito has no "delete attribute" in this call; an empty string is how a pin is
        // cleared. plugins/auth.ts maps empty back to `undefined`, so an unpinned user is
        // correctly treated as having tenant-wide access rather than access to a brand whose
        // id is the empty string.
        { Name: 'custom:brandEntityId', Value: claims.brandEntityId ?? '' },
      ],
    }),
  );
}
