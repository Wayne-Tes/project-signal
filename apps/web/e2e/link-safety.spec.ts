import { expect, test, type Page } from '@playwright/test';
import { presetAppearance, signIn } from './helpers';

/**
 * No data-derived link in the rendered app may be anything but http(s) or an in-app action.
 *
 * Signal URLs are scraped and assistant answers can quote them; a `javascript:` href runs script in
 * an authenticated page on click. Unit tests pin `lib/safe-url.ts`; this asserts the property over
 * the REAL rendered DOM, across the drill-down where scraped URLs are shown.
 */

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
});

async function unsafeHrefs(page: Page): Promise<string[]> {
  return page.$$eval('a[href]', (anchors) =>
    anchors
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => !/^https?:\/\//i.test(h) && !h.startsWith('#') && !/^blob:/i.test(h)),
  );
}

test('the shell renders no non-http link', async ({ page }) => {
  expect(await unsafeHrefs(page)).toEqual([]);
});

test('every source link in the drill-down is http(s)', async ({ page }) => {
  await page.getByRole('button', { name: /dig into score/i }).click();
  /* Scoped to the open panel: the Dashboard's "Top negative clusters" card also uses .drill-row,
     sits under the scrim, and appears as soon as anything is scored. */
  const row = page.locator('.drill-panel:not(.stacked) .drill-row').first();
  await row.waitFor({ timeout: 15_000 }).catch(() => undefined);
  test.skip((await row.count()) === 0, 'nothing scored for this brand yet');
  await row.click();
  await page
    .locator('.signal')
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  expect(await unsafeHrefs(page)).toEqual([]);
  for (const a of await page.locator('.signal a.link').all()) {
    await expect(a).toHaveAttribute('rel', /noopener/);
    await expect(a).toHaveAttribute('target', '_blank');
  }
});
