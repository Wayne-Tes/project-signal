import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

/**
 * Identity Platform web config.
 *
 * These values are public (safe to ship in the client bundle), but they are deliberately
 * NOT defaulted: `NEXT_PUBLIC_*` variables are inlined at build time, so a missing value
 * would silently produce a bundle pointing at the wrong Identity Platform project. Failing
 * loudly at startup is the lesser evil.
 *
 * Set these in `apps/web/.env.local` for local development, and as Docker build args in CI.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in apps/web/.env.local (local) or as a build arg (CI). ` +
        `See docs/ARCHITECTURE.md § apps/web.`,
    );
  }
  return value;
}

const config = {
  apiKey: required('NEXT_PUBLIC_FIREBASE_API_KEY', process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  authDomain: required(
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  ),
  projectId: required(
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  ),
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(firebaseApp);
