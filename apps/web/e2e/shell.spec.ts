import { expect, test } from '@playwright/test';
import { chooseAppearance, goToView, presetAppearance, signIn } from './helpers';

/**
 * The app shell and the controls restored after the shell migration removed
 * them (docs/STUBS.md).
 *
 * These are not decorative assertions. Every control below was silently
 * deleted by a refactor and only noticed because the owner went looking for
 * one of them. A unit test cannot catch that: the components still existed and
 * still passed their own tests — they had simply stopped being rendered.
 */

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  await signIn(page);
});

test.describe('restored top-bar controls', () => {
  test('"Dig into score" is present and opens the drill-down', async ({ page }) => {
    /* The ONLY entry point to the top-level drill-down. With it removed,
       DrillDown was reachable solely by clicking into a dimension or cluster,
       so the overview level was unreachable in the product. */
    const dig = page.getByRole('button', { name: /dig into score/i });
    await expect(dig).toBeVisible();

    await dig.click();
    await expect(page.locator('.drill-panel, [data-testid="drill-panel"]')).toBeVisible();
  });

  test('Export is visible but disabled, not silently missing', async ({ page }) => {
    /* STUBS.md #1. It has never had a handler. Disabled-and-tooltipped is the
       honest state; enabled-and-inert (the original) lies to the user, and
       removed hides a decision the owner never made. */
    const exportBtn = page.getByRole('button', { name: /export/i });
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeDisabled();
  });

  test('the report view swaps "Dig into score" for "Download PDF"', async ({ page }) => {
    await goToView(page, /weekly report/i);
    await expect(page.getByRole('button', { name: /download pdf/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /dig into score/i })).toHaveCount(0);
  });
});

test.describe('appearance popover', () => {
  test('offers every restored setting', async ({ page }) => {
    await page.getByRole('button', { name: /appearance/i }).click();

    /* Each of these was a working control in the prototype Tweaks panel and
       was lost with it. The typeface switcher is retained by owner decision
       despite conflicting with the house style — STUBS.md #4.

       Asserted as labelled radiogroups rather than as visible text: text could
       match a heading elsewhere on the page, whereas a radiogroup with this
       accessible name is unambiguously the control. */
    for (const group of [
      'Theme',
      'Sidebar',
      'Highlight',
      'Dashboard hero',
      'Typeface',
      'Animations',
    ]) {
      await expect(page.getByRole('radiogroup', { name: group })).toBeVisible();
    }
  });

  test('the highlight colour reaches the active nav item', async ({ page }) => {
    /* REGRESSION. The active nav item's class list was built by string
       concatenation that lost its separator, producing one class matching no
       rule — active items rendered with no padding, no tint and no accent bar.
       Reading the computed colour is the only assertion that catches it. */
    await chooseAppearance(page, 'Highlight', 'Purple');
    await page.keyboard.press('Escape');

    const active = page.locator('nav[aria-label="Main"] [aria-current="page"]').first();
    await expect(active).toBeVisible();
    const bg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, 'active nav item should carry the accent tint').not.toBe('rgba(0, 0, 0, 0)');
  });

  test('a chosen theme survives a reload', async ({ page }) => {
    /* The boot script in layout.tsx exists to avoid a flash of the wrong
       theme. If persistence breaks, this is the test that says so. */
    await chooseAppearance(page, 'Theme', 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('navigation', () => {
  test('the sidebar collapses and stays usable', async ({ page }) => {
    const collapse = page.getByRole('button', { name: /collapse|expand/i }).first();
    await expect(collapse).toBeVisible();
    await collapse.click();
    await page.waitForTimeout(300);

    /* Collapsed must still navigate — an icon rail that cannot be clicked is
       worse than no collapse at all. */
    await page.locator('nav[aria-label="Main"] button').nth(1).click();
    await expect(page.locator('nav[aria-label="Main"]')).toBeVisible();
  });

  test('every permitted view renders without a client error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    for (const view of [
      /dashboard/i,
      /trends/i,
      /brand impact/i,
      /action roadmap/i,
      /competitors/i,
      /weekly report/i,
      /admin/i,
    ]) {
      await goToView(page, view);
      await expect(page.locator('.ds-content')).toBeVisible();
    }

    expect(errors, `console errors while navigating: ${errors.join(' | ')}`).toEqual([]);
  });
});
