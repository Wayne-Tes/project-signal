import { expect, test, type Request } from '@playwright/test';
import { goToView, presetAppearance, signIn } from './helpers';

/**
 * The territory lens reaches every view.
 *
 * It did not: Competitors compared global indexes under a UK lens, and the drill-down's
 * dimension-level signals ignored it while the topics above them honoured it. These assertions read
 * the REQUESTS the app makes, because a view can render plausibly under the wrong scope.
 */

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
});

test('choosing a territory scopes Competitors and the drill-down', async ({ page }) => {
  const picker = page.getByLabel('Territory');
  test.skip((await picker.count()) === 0, 'brand collects from fewer than two territories');
  const value = await picker.locator('option').nth(1).getAttribute('value');

  const seen: string[] = [];
  page.on('request', (r: Request) => seen.push(r.url()));

  await picker.selectOption(value!);
  await goToView(page, /competitors/i);
  await expect.poll(() => seen.some((u) => /\/score\?territory=/.test(u))).toBe(true);

  await page.getByRole('button', { name: /dig into score/i }).click();
  const row = page.locator('.drill-row').first();
  test.skip((await row.count()) === 0, 'nothing scored under this lens');
  await row.click();
  await expect
    .poll(() => seen.some((u) => /\/signals\?.*dimension=.*territory=/.test(u)))
    .toBe(true);
});
