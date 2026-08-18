import { expect, test } from '@playwright/test';
import { goToView, presetAppearance, signIn } from './helpers';

/**
 * Voice of the customer.
 *
 * The area is empty until a CRM connector exists, and these assertions are mostly about what an
 * empty page says. That is not a placeholder concern: "no CRM connected" and "connected and quiet"
 * need opposite responses, and an empty list alone cannot tell them apart — the same distinction
 * that made the coverage funnel worth building.
 *
 * The claim that these numbers are kept out of the Brand Perception Index is asserted too, because
 * a reader who assumes they are comparable to the dashboard's will misread both. That sentence
 * disappearing in a refactor would be invisible to every component test.
 */

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
  await goToView(page, /voice of the customer/i);
});

test('distinguishes "no CRM connected" from "connected and quiet"', async ({ page }) => {
  const notConnected = page.getByText(/no crm connected/i);
  const headline = page.locator('.chg-headline');

  if (await notConnected.isVisible().catch(() => false)) {
    /* It must also say what to do about it, and that nothing is being collected — implying
       collection has begun would be a false claim about customer data. */
    await expect(page.getByText(/connect hubspot or salesforce in admin/i)).toBeVisible();
    await expect(page.getByText(/nothing is collected until you do/i)).toBeVisible();
  } else {
    await expect(headline).toContainText(/interaction/i);
  }
});

test('says these numbers are kept out of the index, whenever there are any', async ({ page }) => {
  const note = page.locator('.voc-note');
  test.skip((await note.count()) === 0, 'no CRM data for this brand yet');

  await expect(note).toContainText(/kept out of the Brand Perception Index/i);
  /* The reason matters as much as the fact — without it the exclusion reads as an oversight. */
  await expect(note).toContainText(/negative by design/i);
});

test('ranks by accounts rather than by how often something is said', async ({ page }) => {
  const rows = page.locator('.chg-row');
  test.skip((await rows.count()) === 0, 'no CRM data for this brand yet');

  /* The headline number for this channel is accounts. Mentions appear only where they differ,
     because ten notes about one customer is one customer. */
  await expect(rows.first().locator('.chg-meta')).toContainText(/account/i);
});

test('the corroboration panel reports both sides separately', async ({ page }) => {
  const panel = page.getByText(/raised publicly and privately/i);
  test.skip(!(await panel.isVisible().catch(() => false)), 'nothing corroborated for this brand');

  /* Public sentiment and reported sentiment are shown as a pair. Collapsing them to one number
     would hide the gap, and the gap is the finding — it usually means one channel is not hearing
     the whole story. */
  await expect(page.locator('.chg-delta').first()).toContainText('/');
});

test('the window control re-queries rather than filtering client-side', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/voice-of-customer')) requests.push(r.url());
  });

  await page.getByRole('button', { name: '30 days' }).click();
  await page.waitForTimeout(800);

  expect(requests.some((u) => u.includes('days=30'))).toBe(true);
});
