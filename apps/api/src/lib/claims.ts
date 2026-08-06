import admin from 'firebase-admin';
import type { UserRole } from '../plugins/auth.js';

/**
 * The custom-claim payload. Must stay in step with what `plugins/auth.ts` reads off the
 * decoded token — these three fields *are* the authorisation model. The `users` table is a
 * directory record; it is not consulted when authorising a request.
 */
export interface UserClaims {
  role: UserRole;
  tenantId: string;
  brandEntityId?: string | null;
}

/**
 * Sets a user's custom claims.
 *
 * **Always call this inside the database transaction that writes the matching `users` row.**
 * Because authorisation reads claims and not the table, the two diverging is a security
 * problem rather than a tidiness one: a demotion that updates the row but not the claim leaves
 * the user holding their old access while the table says otherwise. Calling it inside the
 * transaction means a claims failure rolls the row back and neither system moves.
 *
 * The residual window is a commit failure *after* the claims call succeeded, which leaves
 * claims ahead of the table. That cannot be closed without a distributed transaction; it is
 * logged by the caller and is the safer of the two directions, since the claim is the value
 * actually enforced.
 *
 * Claims take effect on the user's next token refresh — up to an hour, or immediately on
 * re-authentication.
 */
export async function setUserClaims(firebaseUid: string, claims: UserClaims): Promise<void> {
  await admin.auth().setCustomUserClaims(firebaseUid, {
    role: claims.role,
    tenantId: claims.tenantId,
    brandEntityId: claims.brandEntityId ?? undefined,
  });
}
