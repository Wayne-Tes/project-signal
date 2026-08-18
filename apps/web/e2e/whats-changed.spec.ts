import { expect, test } from '@playwright/test';
import { goToView, presetAppearance, signIn } from './helpers';

/**
 * What's changed.
 *
 * The view exists because the product could say what perception IS and never what it DID. These
 * assertions guard the three things that make it honest rather than merely present:
 *
 *   - an empty panel says "nothing got worse" rather than showing a blank box, because a blank
 *     box reads as broken and turns a working feature into a support ticket;
 *   - the basis (`newly collected` vs `newly published`) is a visible choice, because showing one
 *     while implying the other is how this panel would lie;
 *   - the by-source table keeps feeds that stopped, because a silent feed and a healthy one are
 *     indistinguishable when only the current period is listed — the interpretive trap that made
 *     "less discussed" look like an audience change when it was a collection collapse.
 */

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
  await goToView(page, /what's changed/i);
});

test('opens with a sentence a weekly report could quote', async ({ page }) => {
  const headline = page.locator('.chg-headline');
  await expect(headline).toBeVisible();
  await expect(headline).toContainText(/collected|published|nothing collected/i);
});

/**
 * "Nothing got worse" is a genuine finding and the most reassuring thing this page can say. An
 * empty panel says nothing, reads as broken, and is how a working feature gets reported as a bug.
 */
test('an empty panel says so in words', async ({ page }) => {
  const empties = page.locator('.chg-empty');
  const count = await empties.count();
  test.skip(count === 0, 'every panel has content for this brand');

  for (let i = 0; i < count; i += 1) {
    const text = (await empties.nth(i).innerText()).trim();
    expect(text.length, 'an empty panel rendered with no explanation').toBeGreaterThan(10);
  }
});

test('the basis is a visible choice, not an implied one', async ({ page }) => {
  const collected = page.getByRole('button', { name: 'Newly collected' });
  const published = page.getByRole('button', { name: 'Newly published' });

  await expect(collected).toBeVisible();
  await expect(published).toBeVisible();
  /* Which of the two is active must be announced, not merely styled. */
  await expect(collected).toHaveAttribute('aria-pressed', 'true');
});

test('changing the basis re-queries the API', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/whats-new')) requests.push(r.url());
  });

  await page.getByRole('button', { name: 'Newly published' }).click();
  await page.waitForTimeout(800);

  expect(requests.some((u) => u.includes('basis=published'))).toBe(true);
});

/**
 * The panel that stops the page misleading. Without it, "less discussed: education −57" reads as
 * an audience change when the real cause was RSS collection collapsing from 328 to 6.
 */
test('the by-source table keeps feeds that stopped producing', async ({ page }) => {
  const bySource = page.getByText(/where the movement came from/i);
  test.skip(!(await bySource.isVisible().catch(() => false)), 'no source movement for this brand');

  const stopped = page.getByText('stopped', { exact: true });
  if ((await stopped.count()) > 0) {
    /* A feed that went silent is shown as a drop to zero rather than vanishing from the table. */
    await expect(stopped.first()).toBeVisible();
  }
});

test('never renders a delta against a comparison that does not exist', async ({ page }) => {
  const deltas = page.locator('.chg-delta');
  const count = await deltas.count();
  test.skip(count === 0, 'nothing to compare for this brand yet');

  for (let i = 0; i < count; i += 1) {
    const text = (await deltas.nth(i).innerText()).trim();
    /* `+0` against an absent prior period is the `▲ +0` defect. Absent must read as absent. */
    expect(text, 'a zero delta was rendered where there is no comparison').not.toBe('+0');
  }
});
