import { expect, test } from '@playwright/test';
import { chooseAppearance, signIn } from './helpers';

/**
 * A chosen theme survives a reload.
 *
 * ITS OWN FILE, and that is the point. A file-level `test.beforeEach` applies to every describe
 * block in it, so this could not live in shell.spec.ts:
 *
 *   - `presetAppearance` writes the theme through `addInitScript`, which re-runs on EVERY
 *     navigation including `reload()`. It would rewrite localStorage during the reload and
 *     overwrite the choice this test had just made — the assertion would fail while persistence
 *     worked perfectly.
 *   - Adding a second `beforeEach` in a nested describe does not replace the file-level one, it
 *     runs after it. Both called `signIn`, the second navigated away from an already-signed-in
 *     shell, and the test then waited 45 seconds for a login form that was never coming back.
 *
 * Both of those were diagnosed from a timeout that named neither cause. Isolation is cheaper
 * than the next hour of confusion.
 *
 * The behaviour itself was confirmed independently before this test was written: choosing Dark
 * writes `ps_theme=dark`, and the boot script in layout.tsx reads it before first paint — which
 * is what stops a dark-theme user seeing a white flash on every navigation.
 */

test.beforeEach(async ({ page }) => {
  /* The tour is a full-screen overlay that intercepts clicks. Nothing else is forced here. */
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
});

test('a chosen theme survives a reload', async ({ page }) => {
  await chooseAppearance(page, 'Theme', 'Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  /* Restored, so a shared e2e account does not leave every later run in dark. */
  await chooseAppearance(page, 'Theme', 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
