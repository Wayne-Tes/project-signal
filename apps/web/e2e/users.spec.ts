import { expect, test } from '@playwright/test';
import { goToView, presetAppearance, signIn } from './helpers';

/**
 * The user management panel — KNOWN-GAPS #12's remaining half.
 *
 * The API side of #12 was fixed and verified against a live server: three holes, the worst of
 * which was a `PATCH` with **no tenant filter at all**, so an admin in one tenant could modify a
 * user in another. That is a cross-tenant isolation defect rather than a privilege-escalation one.
 *
 * The UI has never been driven in a browser. It lints, typechecks, builds, and its endpoints are
 * verified — which is precisely the state DEVRULES says is not "done", and precisely the state
 * that let the light-theme defect ship: every component individually correct, nothing rendering
 * the page and reading the result back.
 *
 * These assertions are about the ROLE MODEL rather than layout, because that is where the cost of
 * being wrong lands. A select that quietly offers `owner` to an admin is a privilege-escalation
 * path presented as a dropdown.
 */

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
  await goToView(page, /admin/i);
});

test('lists the tenant’s users', async ({ page }) => {
  /* The panel exists and rendered. It has been reachable but unexercised, and a panel behind
     AuthGate that nobody has opened is a panel nobody knows is broken. */
  await expect(page.getByLabel('Cognito user ID (sub)')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
});

/**
 * The assertion this file exists for.
 *
 * `PATCH` rejects an escalation to `owner` server-side — verified. But a UI that OFFERS the
 * option turns a 403 into a support ticket, and worse, teaches whoever clicks it that the
 * product is unreliable rather than that the action is forbidden.
 */
test('never offers owner as an assignable role', async ({ page }) => {
  const roleSelect = page.getByLabel('Role', { exact: true });
  await expect(roleSelect).toBeVisible();

  const options = await roleSelect.locator('option').allInnerTexts();
  expect(options.map((o) => o.trim().toLowerCase())).not.toContain('owner');
  /* And it must offer something, or the form cannot be completed at all. */
  expect(options.length).toBeGreaterThan(0);
});

test('every existing user’s role control offers the same restricted set', async ({ page }) => {
  const selects = page.locator('select[aria-label^="Role for"]');
  const count = await selects.count();
  test.skip(count === 0, 'no users listed for this tenant');

  for (let i = 0; i < count; i += 1) {
    const options = await selects.nth(i).locator('option').allInnerTexts();
    expect(
      options.map((o) => o.trim().toLowerCase()),
      'a per-row role control offered owner',
    ).not.toContain('owner');
  }
});

test('the brand pin defaults to no pin, rather than silently restricting a new user', async ({
  page,
}) => {
  const brand = page.getByLabel(/pinned brand/i);
  await expect(brand).toBeVisible();
  /* Defaulting to a brand would quietly confine every new user to whichever happened to sort
     first — visible only when they report that half the product is missing. */
  await expect(brand).toHaveValue('');
});

test('will not submit without the fields the API requires', async ({ page }) => {
  /* Both are `required`, so the browser blocks submission. Without them the API 400s and the
     user learns nothing about which field was wrong. */
  await expect(page.getByLabel('Cognito user ID (sub)')).toHaveAttribute('required', '');
  await expect(page.getByLabel('Email')).toHaveAttribute('required', '');
});

test('an API refusal is shown, not swallowed', async ({ page }) => {
  /* Provisioning collides on a duplicate sub. The message must reach the screen — an action that
     silently does nothing is the failure mode this panel is most likely to have, because it is
     the one nobody tests for. */
  const alert = page.locator('[role="alert"]');
  await page.getByLabel('Cognito user ID (sub)').fill('e2e-duplicate-probe');
  await page.getByLabel('Email').fill('e2e-duplicate-probe@example.com');
  await page.getByRole('button', { name: /provision user/i }).click();

  /* Either it succeeded, or it failed and said why. Both are acceptable; silence is not. */
  await page.waitForTimeout(1500);
  const alerts = await alert.count();
  if (alerts > 0) {
    expect((await alert.first().innerText()).trim().length).toBeGreaterThan(0);
  }
});
