import { expect, test } from '@playwright/test';
import { authMode, credentials, signIn } from './helpers';

/**
 * The local-development sign-in, end to end against the real API in AUTH_MODE=local.
 *
 * Only meaningful against a local build (NEXT_PUBLIC_AUTH_MODE=local). Against Cognito the whole
 * file is skipped — it says so, rather than passing vacuously.
 */

test.skip(authMode() !== 'local', 'local sign-in specs run only against a local-mode build');

/* The first-run tour is a full-screen overlay that intercepts clicks; help.spec.ts covers it. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
});

test('is labelled as local development', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('local-auth-badge')).toHaveText(/local development sign-in/i);
  await expect(page.getByLabel('Username')).toBeVisible();
});

test('refuses a wrong password, and says so', async ({ page }) => {
  const { identifier } = credentials();
  await page.goto('/');
  await page.locator('#identifier').fill(identifier);
  await page.locator('#password').fill('definitely-not-the-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  /* Filtered, not bare: Next.js renders its own role=alert route announcer on every page. */
  await expect(
    page.getByRole('alert').filter({ hasText: /check your username and password/i }),
  ).toBeVisible();
  await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(0);
});

test('signs in, survives a reload in the same tab, and signs out', async ({ page }) => {
  await signIn(page, { viaForm: true });
  await page.reload();
  await expect(page.locator('nav[aria-label="Main"]')).toBeVisible();
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByLabel('Username')).toBeVisible();
});

test('a session the API rejects returns the user to sign-in', async ({ page }) => {
  await signIn(page);
  /* Corrupt the stored token: the next API call gets a 401, which must return the user to the
     sign-in screen with a reason rather than leaving every view erroring. */
  await page.evaluate(() => {
    const raw = sessionStorage.getItem('ps.local-session');
    if (!raw) throw new Error('no local session stored');
    const session = JSON.parse(raw) as { token: string };
    /* Not a dev token and not a JWT: the API must reject it outright. */
    session.token = 'not-a-token';
    sessionStorage.setItem('ps.local-session', JSON.stringify(session));
  });
  await page.getByRole('button', { name: /export/i }).click();
  await expect(page.getByText(/your session has ended/i)).toBeVisible({ timeout: 15_000 });
});
