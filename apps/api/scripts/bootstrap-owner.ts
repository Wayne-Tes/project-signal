/* eslint-disable no-console -- CLI script: stdout is the user-facing interface */
/**
 * Bootstrap the first owner for an environment.
 *
 * Creates the Cognito user if missing and sets `custom:role = owner`, so they can authenticate
 * and call the owner-only endpoints (notably POST /admin/tenants, which onboards everyone else).
 * Owner authorisation is claim-based, so no `users` row is required to bootstrap — the row
 * arrives when the owner creates their tenant.
 *
 * This is the chicken-and-egg breaker: every other user is provisioned through the API by
 * someone who is already an owner or admin.
 *
 * Usage:
 *   AWS_PROFILE=psignal-dev \
 *   COGNITO_USER_POOL_ID=<pool id> \
 *   npx tsx apps/api/scripts/bootstrap-owner.ts <email>
 *
 * Credentials come from the SDK's default chain. Cognito emails the temporary password; the
 * user is forced to change it on first sign-in, so no password is ever printed or transmitted
 * by this script.
 */
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';

const email = process.argv[2] ?? process.env['OWNER_EMAIL'];
if (!email) {
  console.error('Usage: bootstrap-owner <email>');
  process.exit(1);
}

// No default: writing owner claims into the wrong user pool is not a recoverable mistake.
const userPoolId = process.env['COGNITO_USER_POOL_ID'];
if (!userPoolId) {
  console.error('COGNITO_USER_POOL_ID must be set — refusing to guess the target user pool.');
  process.exit(1);
}

const client = new CognitoIdentityProviderClient({});

/** Cognito's `sub`, which is what `users.firebase_uid` stores and what tokens carry. */
async function findOrCreate(): Promise<string> {
  try {
    const existing = await client.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }),
    );
    const sub = existing.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
    console.log(`user already exists: ${sub}`);
    return sub!;
  } catch (err) {
    if (!(err instanceof UserNotFoundException)) throw err;

    const created = await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          // Marking the address verified is what allows the forgot-password flow to work later.
          // The pool is admin-create-only, so the address is trusted by construction.
          { Name: 'email_verified', Value: 'true' },
        ],
        // Cognito generates a temporary password and emails it. DesiredDeliveryMediums must be
        // set explicitly or the invitation is not sent at all and the account is unusable.
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
    const sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    console.log(`created user: ${sub} (invitation emailed to ${email})`);
    return sub!;
  }
}

const sub = await findOrCreate();

// Only the role is set. tenantId is deliberately left empty: the owner has no tenant until they
// create one, and POST /admin/tenants writes both the tenant and the owner's claims in a single
// transaction. Inventing a tenant id here would create a claim pointing at nothing.
// Addressed by `sub` rather than by email, matching lib/claims.ts. With
// `username_attributes = ["email"]` the pool's actual username IS the sub, and using one
// consistently means an email change never breaks the claim-writing path.
await client.send(
  new AdminUpdateUserAttributesCommand({
    UserPoolId: userPoolId,
    Username: sub,
    UserAttributes: [{ Name: 'custom:role', Value: 'owner' }],
  }),
);
console.log(`set custom:role=owner for ${email}`);

console.log(
  '\nNext: sign in with the temporary password from the invitation email. Cognito will force ' +
    'a password change on first sign-in, after which POST /admin/tenants creates the tenant.',
);
