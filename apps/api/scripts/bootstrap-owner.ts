/* eslint-disable no-console -- CLI script: stdout is the user-facing interface */
/**
 * Bootstrap the first owner for an environment.
 *
 * Creates the Identity Platform user (if missing) and sets the `role: owner` custom claim,
 * so they can authenticate and call the owner-only endpoints (e.g. POST /admin/tenants).
 * Owner authz is claim-based, so no DB row is required.
 *
 * Usage: GOOGLE_CLOUD_PROJECT=<your-gcp-project> npx tsx apps/api/scripts/bootstrap-owner.ts <email>
 * Auth: uses Application Default Credentials (run `gcloud auth application-default login`).
 */
import admin from 'firebase-admin';

const email = process.argv[2] ?? process.env['OWNER_EMAIL'];
if (!email) {
  console.error('Usage: bootstrap-owner <email>');
  process.exit(1);
}

// No default: writing owner claims into the wrong project is not a recoverable mistake.
const projectId = process.env['GOOGLE_CLOUD_PROJECT'];
if (!projectId) {
  console.error('GOOGLE_CLOUD_PROJECT must be set — refusing to guess the target project.');
  process.exit(1);
}
admin.initializeApp({ projectId });
const auth = admin.auth();

const user = await auth
  .getUserByEmail(email)
  .then((u) => {
    console.log(`user already exists: ${u.uid}`);
    return u;
  })
  .catch(async () => {
    const u = await auth.createUser({ email, emailVerified: true });
    console.log(`created user: ${u.uid}`);
    return u;
  });

await auth.setCustomUserClaims(user.uid, { role: 'owner' });
console.log(`set custom claim role=owner for ${email}`);

const resetLink = await auth.generatePasswordResetLink(email);
console.log('\nSet-password link (open to set the owner password):\n' + resetLink);
