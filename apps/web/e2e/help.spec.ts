import { expect, test } from '@playwright/test';
import { goToView, openHelpIndex, presetAppearance, signIn } from './helpers';

/**
 * The help centre and the first-run tour.
 *
 * Driven as a user would: open it from the top bar, search, read, follow a cross-reference.
 * The corpus itself is unit-tested for integrity in `libs/help-content`; what only this can
 * check is that the content is actually reachable and readable in the product.
 */

test.describe('help centre', () => {
  test.beforeEach(async ({ page }) => {
    await presetAppearance(page, { theme: 'light' });
    /* Suppress the first-run tour for these tests — it covers the screen, and it is the subject
       of its own block below rather than an obstacle here. */
    await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
    await signIn(page);
  });

  test('opens from the top bar and reaches the full index', async ({ page }) => {
    /* Clicking Help lands on the current view's article — contextual help, asserted in the next
       test. The index is one step further back, and both routes must work. */
    await page.getByRole('button', { name: /^help$/i }).click();
    await expect(page.getByTestId('help-centre')).toBeVisible();

    await page.getByRole('button', { name: /all articles/i }).click();
    await expect(page.getByLabel('Search help')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  });

  test('opens the article for the view the user is on', async ({ page }) => {
    /* Contextual help. Someone stuck on Brand impact should not have to find the right article
       in an index — the whole value is landing on it. */
    await goToView(page, /brand impact/i);
    await page.getByRole('button', { name: /^help$/i }).click();
    await expect(page.getByRole('heading', { name: /brand impact/i }).first()).toBeVisible();
    await expect(page.getByTestId('help-centre')).toContainText('damage');
  });

  test('finds an article by a phrase the prose never uses', async ({ page }) => {
    await openHelpIndex(page);
    await page.getByLabel('Search help').fill('nothing showing');
    await expect(page.getByTestId('help-centre')).toContainText('Why is my dashboard empty');
  });

  test('says what to do next when nothing matches', async ({ page }) => {
    await openHelpIndex(page);
    await page.getByLabel('Search help').fill('kubernetes ingress sidecar');
    /* Reporting failure alone leaves the user stuck; the assistant can answer things the
       corpus cannot, and this is the moment they need to know that. */
    await expect(page.getByTestId('help-centre')).toContainText(/ask the assistant/i);
  });

  test('follows a cross-reference and comes back', async ({ page }) => {
    await openHelpIndex(page);
    await page.getByRole('button', { name: /understanding the brand perception index/i }).click();
    await expect(page.getByTestId('help-centre')).toContainText('50 is genuinely neutral');

    await page.getByRole('button', { name: /how recency works/i }).first().click();
    await expect(page.getByTestId('help-centre')).toContainText('half-life');

    await page.getByRole('button', { name: /all articles/i }).click();
    await expect(page.getByLabel('Search help')).toBeVisible();
  });

  test('renders tables and formulae rather than raw markdown', async ({ page }) => {
    await openHelpIndex(page);
    await page.getByRole('button', { name: /understanding the brand perception index/i }).click();
    const panel = page.getByTestId('help-centre');
    await expect(panel.locator('table')).toBeVisible();
    await expect(panel.locator('pre')).toBeVisible();
    /* If the renderer ever fails open, this is what the user would see instead. */
    await expect(panel).not.toContainText('| --- |');
    await expect(panel).not.toContainText('**');
  });

  test('closes on Escape', async ({ page }) => {
    await page.getByRole('button', { name: /^help$/i }).click();
    await expect(page.getByTestId('help-centre')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-centre')).not.toBeVisible();
  });

  test('is readable in dark theme', async ({ page }) => {
    /* The overlay surfaces are the newest place the black-tiles defect could recur. */
    await presetAppearance(page, { theme: 'dark' });
    await page.reload();
    await page.getByRole('button', { name: /^help$/i }).click();
    const panel = page.getByTestId('help-centre');
    const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    const fg = await panel.evaluate((el) => getComputedStyle(el).color);
    expect(bg).not.toBe(fg);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('first-run tour', () => {
  /* NO tour-suppressing init script here. `addInitScript` re-runs on EVERY navigation,
     including `reload()`, so a beforeEach that sets the completed flag would put it back the
     moment the test cleared it and reloaded — the tour would never appear and the test would
     fail on a timeout that says nothing about why. */
  test.beforeEach(async ({ page }) => {
    await presetAppearance(page, { theme: 'light' });
    await signIn(page);
  });

  test('offers itself to a new user and can be dismissed for good', async ({ page }) => {
    const tour = page.getByTestId('tour');
    await expect(tour).toBeVisible();
    await expect(tour).toContainText('Step 1 of');

    await tour.getByRole('button', { name: /^next$/i }).click();
    await expect(tour).toContainText('Step 2 of');

    await tour.getByRole('button', { name: /^skip$/i }).click();
    await expect(tour).not.toBeVisible();

    /* The promise that matters: it does not come back. */
    await page.reload();
    await expect(page.locator('nav[aria-label="Main"]')).toBeVisible();
    await expect(page.getByTestId('tour')).not.toBeVisible();
  });

  test('can be restarted from the help centre', async ({ page }) => {
    /* Someone who skipped it needs a way back, and the help centre is where they will look. */
    const open = page.getByTestId('tour');
    if (await open.isVisible().catch(() => false)) {
      await open.getByRole('button', { name: /^skip$/i }).click();
    }
    await openHelpIndex(page);
    await page.getByRole('button', { name: /start tour/i }).click();
    await expect(page.getByTestId('tour')).toBeVisible();
    await page.getByTestId('tour').getByRole('button', { name: /^skip$/i }).click();
  });
});
