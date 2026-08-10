import { expect, test, type Page } from '@playwright/test';
import { goToView, presetAppearance, signIn } from './helpers';

/**
 * Feeds, and the drill-down steps.
 *
 * THE REGRESSIONS THIS GUARDS.
 *
 * 1. A brand could hold **one feed of each source type**, and the failure was silent: adding a
 *    second RSS feed did not error, it overwrote the first, and the panel then showed one row as
 *    though that had always been the whole configuration. Tracking both `"Tes Global"` and
 *    `"Tes MyConcern"` on Google News was impossible.
 * 2. **Reddit did not exist** anywhere in the system — not in the type union, not in
 *    `COLLECTING_SOURCES`, no adapter.
 * 3. The drill-down's **stacked numbered steps** were deleted by the mock-data rewrite. Their CSS
 *    stayed behind, styling elements that no longer existed, so nothing noticed.
 *
 * SELF-CLEANING. Every feed created here carries a marker in its name and is removed at the end;
 * a sweep also clears anything a previous crashed run left behind, so a failure never poisons the
 * next run or leaves rubbish in a shared environment.
 */

const MARK = 'ZZ E2E';

/** Removes every feed this spec has ever created, whatever state a previous run died in. */
async function sweep(page: Page): Promise<void> {
  const panel = page.locator('section', { hasText: 'Feeds' }).first();
  for (let guard = 0; guard < 10; guard += 1) {
    const stale = panel.getByRole('button', { name: new RegExp(`^Remove ${MARK}`) });
    if ((await stale.count()) === 0) return;
    await stale.first().click();
    await panel.getByRole('button', { name: 'Confirm remove' }).click();
    await expect(stale).toHaveCount(await stale.count().then((n) => Math.max(0, n - 1)), {
      timeout: 15_000,
    });
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
});

test('offers Reddit as a feed type', async ({ page }) => {
  await goToView(page, /admin/i);
  const types = page.locator('#sourceType');
  await expect(types).toBeVisible();
  await expect(types.locator('option', { hasText: 'Reddit' })).toHaveCount(1);
});

test('asks for a search term and an optional subreddit for Reddit', async ({ page }) => {
  await goToView(page, /admin/i);
  await page.locator('#sourceType').selectOption('reddit');

  await expect(page.getByLabel('Search term')).toBeVisible();
  await expect(page.getByLabel('Subreddit (optional)')).toBeVisible();
});

test('holds TWO feeds of the same type at once', async ({ page }) => {
  await goToView(page, /admin/i);
  await sweep(page);
  const panel = page.locator('section', { hasText: 'Feeds' }).first();

  const first = `${MARK} Global`;
  const second = `${MARK} MyConcern`;

  await page.locator('#sourceType').selectOption('rss');
  await page.locator('#sourceLabel').fill(first);
  await page.locator('#f-feedUrl').fill('https://news.google.com/rss/search?q=%22ZZ+E2E+One%22');
  await panel.getByRole('button', { name: 'Add feed' }).click();
  await expect(panel.locator('li', { hasText: first })).toBeVisible({ timeout: 15_000 });

  await page.locator('#sourceLabel').fill(second);
  await page.locator('#f-feedUrl').fill('https://news.google.com/rss/search?q=%22ZZ+E2E+Two%22');
  await panel.getByRole('button', { name: 'Add feed' }).click();

  /* BOTH. This is the assertion the old system could never satisfy — the second used to replace
     the first, leaving exactly one row and no indication anything had been lost. */
  await expect(panel.locator('li', { hasText: first })).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('li', { hasText: second })).toBeVisible();

  await sweep(page);
  await expect(panel.locator('li', { hasText: first })).toHaveCount(0);
});

test('refuses the same feed twice, and says why', async ({ page }) => {
  await goToView(page, /admin/i);
  await sweep(page);
  const panel = page.locator('section', { hasText: 'Feeds' }).first();
  const url = 'https://news.google.com/rss/search?q=%22ZZ+E2E+Dup%22';

  await page.locator('#sourceType').selectOption('rss');
  await page.locator('#sourceLabel').fill(`${MARK} Dup`);
  await page.locator('#f-feedUrl').fill(url);
  await panel.getByRole('button', { name: 'Add feed' }).click();
  await expect(panel.locator('li', { hasText: `${MARK} Dup` })).toBeVisible({ timeout: 15_000 });

  await page.locator('#sourceLabel').fill(`${MARK} Dup again`);
  await page.locator('#f-feedUrl').fill(url);
  await panel.getByRole('button', { name: 'Add feed' }).click();

  await expect(panel.getByRole('alert')).toContainText(/already configured/i, { timeout: 15_000 });

  await sweep(page);
});

test('renames one feed without touching the other', async ({ page }) => {
  await goToView(page, /admin/i);
  await sweep(page);
  const panel = page.locator('section', { hasText: 'Feeds' }).first();

  await page.locator('#sourceType').selectOption('rss');
  await page.locator('#sourceLabel').fill(`${MARK} Keep`);
  await page.locator('#f-feedUrl').fill('https://news.google.com/rss/search?q=%22ZZ+E2E+Keep%22');
  await panel.getByRole('button', { name: 'Add feed' }).click();
  await expect(panel.locator('li', { hasText: `${MARK} Keep` })).toBeVisible({ timeout: 15_000 });

  await page.locator('#sourceLabel').fill(`${MARK} Rename`);
  await page.locator('#f-feedUrl').fill('https://news.google.com/rss/search?q=%22ZZ+E2E+Rename%22');
  await panel.getByRole('button', { name: 'Add feed' }).click();
  const target = panel.locator('li', { hasText: `${MARK} Rename` });
  await expect(target).toBeVisible({ timeout: 15_000 });

  await target.getByRole('button', { name: `Edit ${MARK} Rename` }).click();
  await page.getByLabel('Name').fill(`${MARK} Renamed`);
  await panel.getByRole('button', { name: 'Save' }).click();

  await expect(panel.locator('li', { hasText: `${MARK} Renamed` })).toBeVisible({ timeout: 15_000 });
  /* The other one is untouched. Editing by source TYPE would have hit whichever row the API
     happened to find first. */
  await expect(panel.locator('li', { hasText: `${MARK} Keep` })).toBeVisible();

  await sweep(page);
});

test('the drill-down stacks a numbered step for each level passed', async ({ page }) => {
  /* The feature the owner remembered and could not find. Each completed level collapses to a
     narrow spine — 01, 02 — standing as its own column beside the open panel. */
  await goToView(page, /overview/i);

  const opener = page.locator('.drill-hint, .clickable').first();
  await opener.click();
  await expect(page.locator('.drill-panel')).toBeVisible({ timeout: 15_000 });

  /* One level in: an open panel, no spines yet. */
  await expect(page.locator('.drill-panel.stacked')).toHaveCount(0);

  /* Go one level deeper. The first row in the drill list is a dimension. */
  const deeper = page.locator('.drill-row').first();
  if ((await deeper.count()) > 0) {
    await deeper.click();

    const spine = page.locator('.drill-panel.stacked');
    await expect(spine).toHaveCount(1, { timeout: 15_000 });
    await expect(spine.locator('.drill-spine .lvl')).toHaveText('01');

    /* And it goes back. A spine that only decorates is the breadcrumb with extra steps. */
    await spine.click();
    await expect(page.locator('.drill-panel.stacked')).toHaveCount(0);
  }
});

/**
 * Nothing may bleed past the card it lives in.
 *
 * THE REGRESSION. Every card on the Admin page is 720px. "Manage brand" grew to 963 — it
 * overflowed its own card by 245px and the rows hung over the edge of the column. The cause is a
 * CSS default that is easy to forget: a flex item's `min-width` is `auto`, so it REFUSES to
 * shrink below its own content. One un-truncated Google News URL in a `nowrap` span therefore
 * widened the row, the list, the section and the card, all the way up.
 *
 * No unit test could have caught it. jsdom has no layout engine, so `scrollWidth` there is always
 * 0 and every element "fits". This assertion needs a real browser, which is what this harness is
 * for — the same reason it exists at all, after a light theme painted black cards while every
 * unit test passed.
 *
 * Written as a sweep over every card rather than against the one that broke, because the next
 * panel someone adds will have the same default working against it.
 */
test('no panel overflows its card', async ({ page }) => {
  await goToView(page, /admin/i);
  await expect(page.locator('#sourceType')).toBeVisible();

  const overflowing = await page.evaluate(() => {
    /* The cards are inline-styled rather than classed, so they are found by the 14px radius that
       defines the card in this app — the same value `card` in BrandManager.tsx sets. */
    const cards = [...document.querySelectorAll('div')].filter((d) => {
      const s = getComputedStyle(d);
      return s.borderRadius === '14px' && s.borderStyle === 'solid';
    });
    return cards
      .map((c) => ({
        title: c.querySelector('h2')?.textContent?.trim() ?? '(untitled)',
        clientWidth: c.clientWidth,
        scrollWidth: c.scrollWidth,
      }))
      /* One pixel of slack for sub-pixel rounding; 245 is not rounding. */
      .filter((c) => c.scrollWidth > c.clientWidth + 1);
  });

  expect(overflowing, `panels wider than their card: ${JSON.stringify(overflowing)}`).toEqual([]);
});

test('a feed row keeps its controls reachable however long the URL', async ({ page }) => {
  /* The identifier truncates; the buttons do not get pushed off. Asserted on real geometry
     because that is the only place the difference shows. */
  await goToView(page, /admin/i);
  const panel = page.locator('section', { hasText: 'Feeds' }).first();
  const firstRow = panel.locator('li').first();
  await expect(firstRow).toBeVisible();

  const fits = await firstRow.evaluate((li) => {
    const row = li.getBoundingClientRect();
    const buttons = [...li.querySelectorAll('button')];
    return {
      rowOverflows: li.scrollWidth > li.clientWidth + 1,
      buttonsInside: buttons.every((b) => b.getBoundingClientRect().right <= row.right + 1),
      buttonCount: buttons.length,
    };
  });

  expect(fits.rowOverflows).toBe(false);
  expect(fits.buttonsInside).toBe(true);
  /* Enabled, Edit, Remove — if the row silently lost one, "buttons are inside" is trivially true. */
  expect(fits.buttonCount).toBeGreaterThanOrEqual(3);
});
