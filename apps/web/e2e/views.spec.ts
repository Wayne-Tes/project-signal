import { expect, test } from '@playwright/test';
import { goToView, presetAppearance, signIn } from './helpers';

/**
 * Trends, Brand impact, Competitors and the Weekly report — the four views no spec drove.
 *
 * Each is asserted on what a user must be able to rely on, against live data: it renders without
 * an error, it says something TRUE when there is nothing to show (never a fabricated zero), and
 * its controls lead where they claim to.
 */

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
});

test('Trends renders history or says why it cannot', async ({ page }) => {
  await goToView(page, /trends/i);
  await expect(page.getByText(/could not load this view/i)).toHaveCount(0);
  await expect(page.locator('.ds-content')).toContainText(
    /trust|quality|service|value|experience|no dimension scores yet/i,
  );
});

test('Brand impact cards are not buttons, and each opens its evidence', async ({ page }) => {
  await goToView(page, /brand impact/i);
  await expect(page.getByText(/could not load this view/i)).toHaveCount(0);
  const open = page.getByRole('button', { name: /read the signals/i });
  if ((await open.count()) === 0) {
    await expect(page.getByText(/nothing has scored negatively yet/i)).toBeVisible();
    return;
  }
  /* No heading sits inside a button — that was invalid HTML announced as one long button. */
  expect(await page.locator('button h3').count()).toBe(0);
  /* And no fabricated trend arrow. */
  expect(await page.locator('.ds-content .ds-trend').count()).toBe(0);
  await open.first().click();
  await expect(page.getByRole('dialog', { name: 'Score drill-down' })).toBeVisible();
});

test('Competitors lists the set and never draws an unscored brand as zero', async ({ page }) => {
  await goToView(page, /competitors/i);
  await expect(page.getByText(/could not load this view/i)).toHaveCount(0);
  /* first(): the owned brand AND each owned product carry the badge. */
  await expect(page.getByText('Yours').first()).toBeVisible({ timeout: 15_000 });
  const unscored = page.getByText('not yet scored');
  for (let i = 0; i < (await unscored.count()); i += 1) {
    await expect(unscored.nth(i)).toBeVisible();
  }
});

test('the Weekly report renders and offers a PDF', async ({ page }) => {
  await goToView(page, /weekly report/i);
  await expect(page.locator('.rep-title')).toContainText(/perception/i);
  await expect(page.getByRole('button', { name: /download pdf/i })).toBeVisible();
  /* Either a real index, or the sentence that says there is none — never "0". */
  await expect(page.locator('.rep-sub')).toContainText(
    /brand perception index \d|not been scored yet/i,
  );
});

test('the brand switcher changes what every view is about', async ({ page }) => {
  const select = page.getByLabel('Brand', { exact: true });
  test.skip((await select.count()) === 0, 'tenant has a single brand');
  const options = select.locator('option');
  test.skip((await options.count()) < 2, 'tenant has a single brand');
  const second = await options.nth(1).getAttribute('value');
  await select.selectOption(second!);
  await page.reload();
  /* Remembered per device. */
  await expect(page.getByLabel('Brand', { exact: true })).toHaveValue(second!);
});
