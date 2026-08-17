import { expect, test, type Page } from '@playwright/test';
import { goToView, presetAppearance, signIn } from './helpers';

/**
 * The drill-down, driven the way the defect was found.
 *
 * THE REGRESSION THIS GUARDS. The owner clicked a dimension reading
 * `Experience — 5 signals contributed`, scoring **69.2, the brand's highest**, and the panel that
 * opened said `No topic cluster has been tagged to experience yet`. Two screenshots, one question:
 * "why the disconnect?"
 *
 * Neither level was wrong in isolation. Level 1 reads `dimension_scores.signal_count`. Level 2
 * read `/brand-impact`, which excludes zero-damage clusters BY DESIGN, so a dimension people are
 * positive about has no qualifying cluster at all. The consequence is perverse and was invisible
 * to every existing test: **the better a dimension performs, the more certain its drill-down is to
 * be empty**, on the one screen whose whole purpose is tracing a number to its evidence.
 *
 * WHY THIS BELONGS IN THE BROWSER SUITE AND NOT ONLY IN VITEST. The unit tests assert the
 * component asks `/topics` rather than `/brand-impact`, which is the mechanism. They cannot assert
 * that a real brand, with real scored signals, actually produces something behind the number —
 * that depends on the scorer's output, the rollup and the clustering agreeing with each other
 * against live data. Only driving it proves that, and this defect lived precisely in the gap
 * between three individually-correct pieces.
 *
 * READ-ONLY. This spec opens panels and reads them. It creates nothing and deletes nothing, so it
 * is safe against a shared environment.
 */

/** The open panel — every earlier level has collapsed to a `.stacked` spine. */
function panel(page: Page) {
  return page.locator('.drill-panel:not(.stacked)');
}

/**
 * Opens the drill-down at level 1 through the real affordance.
 *
 * `Dig into score` in the top bar is the only entry point to the top level — `App.tsx` says so in
 * a comment, having lost it once. Asking for it by its visible name is the same discipline the
 * products spec adopted after an icon-only control shipped that nobody could find.
 */
async function openDrillDown(page: Page): Promise<void> {
  await goToView(page, /dashboard/i);
  await page.getByRole('button', { name: /dig into score/i }).click();
  await expect(panel(page)).toBeVisible({ timeout: 15_000 });
  await expect(panel(page).locator('.drill-row').first()).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  /* The first-run tour is a full-screen overlay that swallows clicks; covered in help.spec.ts. */
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
});

/**
 * Opens the drill-down at level 1 and steps into the highest-scoring dimension.
 *
 * The HIGHEST deliberately, not the first. The bug only appears on a dimension whose signals are
 * positive, so a spec that always drilled into the worst-performing one would have passed against
 * the broken build every time.
 */
async function openBestDimension(page: Page): Promise<string> {
  await openDrillDown(page);

  const rows = panel(page).locator('.drill-row');
  const scores = await rows.locator('.lead').allInnerTexts();
  const best = scores.reduce(
    (acc, text, i) => (Number.parseFloat(text) > acc.value ? { i, value: Number.parseFloat(text) } : acc),
    { i: 0, value: Number.NEGATIVE_INFINITY },
  );

  const chosen = rows.nth(best.i);
  const name = (await chosen.locator('.nm').innerText()).trim();
  await chosen.click();
  await expect(panel(page).locator('.drill-title')).toHaveText(name, { timeout: 15_000 });
  return name;
}

test('the best-performing dimension does not dead-end', async ({ page }) => {
  const name = await openBestDimension(page);

  /* The exact copy the owner was shown. It is still reachable — a dimension genuinely nothing has
     been scored on says so — but NOT for a dimension level 1 has just counted signals for. */
  await expect(panel(page)).not.toContainText(/No topic cluster has been tagged/i);

  /* Something must be behind the number: a topic, or the signals themselves. Both are acceptable
     outcomes; an empty panel is not. */
  const topics = await panel(page).locator('.drill-row').count();
  const signals = await panel(page).locator('.signal').count();
  expect(topics + signals, `nothing rendered behind ${name}`).toBeGreaterThan(0);
});

test('every dimension the index counts leads somewhere', async ({ page }) => {
  /* The defect affected one dimension visibly and would have affected any positive one. Walking
     all of them is what stops it coming back on a different dimension as sentiment shifts. */
  await openDrillDown(page);

  const count = await panel(page).locator('.drill-row').count();
  expect(count, 'no dimensions on the overview level').toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const row = panel(page).locator('.drill-row').nth(i);
    const label = (await row.locator('.nm').innerText()).trim();
    const contributed = Number.parseInt((await row.locator('.ds').innerText()).trim(), 10);
    await row.click();
    await expect(panel(page).locator('.drill-title')).toHaveText(label, { timeout: 15_000 });

    if (contributed > 0) {
      const topics = await panel(page).locator('.drill-row').count();
      const signals = await panel(page).locator('.signal').count();
      expect(
        topics + signals,
        `${label} says ${contributed} signals contributed but shows nothing`,
      ).toBeGreaterThan(0);
    }

    /* Back to level 1 via the spine — which also exercises that the stacked step navigates. */
    await page.locator('.drill-panel.stacked').first().click();
    await expect(panel(page).locator('.drill-row').first()).toBeVisible({ timeout: 15_000 });
  }
});

test('a positive topic reports strength, never a damage of 0.0', async ({ page }) => {
  /* "damage 0.0" against a topic people like reads as a broken number rather than as good news,
     and it is what a positive cluster produces by construction. */
  await openBestDimension(page);
  const rows = panel(page).locator('.drill-row');
  if ((await rows.count()) === 0) test.skip(true, 'no topic clusters formed for this dimension yet');

  for (const text of await rows.locator('.ds').allInnerTexts()) {
    expect(text, 'a cluster reported damage 0.0 instead of its strength').not.toMatch(/damage 0\.0/);
  }
});

test('the drill-down reaches individual signals with links to the source', async ({ page }) => {
  /* The product's actual claim: every number traces to the specific things people said. The last
     level either links out to where a signal was published or says no URL was recorded — it never
     invents a quotation, which is the one thing this component must never do. */
  await openBestDimension(page);

  const signals = panel(page).locator('.signal');
  if ((await signals.count()) === 0) {
    const topics = panel(page).locator('.drill-row');
    if ((await topics.count()) === 0) test.skip(true, 'brand has no scored evidence yet');
    await topics.first().click();
    await expect(panel(page).locator('.signal').first()).toBeVisible({ timeout: 15_000 });
  }

  const first = panel(page).locator('.signal').first();
  await expect(first).toBeVisible();
  await expect(first.locator('.sig-foot')).toHaveText(/read the original|no source URL recorded/);
});

/**
 * The numbered spines, read out of a REAL browser.
 *
 * Reported by the owner as "all of the side column spines are numbered 01". The component test
 * (`apps/web/test/drilldown.test.tsx`) already asserts `['01', '02']` at three levels and passes,
 * so the numbering logic is not at fault — which leaves the things jsdom cannot see: the CSS that
 * renders them (`writing-mode: vertical-rl` with a 180° rotation), and whichever bundle is
 * actually deployed at the time.
 *
 * That is precisely the gap this harness exists for. The light-theme defect got through because
 * every component was individually correct and nothing rendered the page and read the value back.
 */
test('the stacked steps are numbered in order, and are legible', async ({ page }) => {
  await openBestDimension(page);

  const topics = panel(page).locator('.drill-row');
  if ((await topics.count()) === 0) test.skip(true, 'no topic clusters formed for this brand yet');
  await topics.first().click();
  await expect(page.locator('.drill-panel.stacked')).toHaveCount(2, { timeout: 15_000 });

  /* The reported symptom, asserted directly: consecutive numbers, not '01' twice. */
  const numbers = await page.locator('.drill-spine .lvl').allInnerTexts();
  expect(numbers.map((n) => n.trim()), 'the stacked steps are not numbered in order').toEqual([
    '01',
    '02',
  ]);

  /* Zero-padding is what makes 01 and 10 the same width so the spines line up; a bare '1' would
     pass the equality above only by accident of there being fewer than ten levels. */
  for (const n of numbers) expect(n.trim()).toMatch(/^\d{2}$/);

  /* Rendered, not merely present. A spine collapsed to zero width — which the vertical writing
     mode makes possible — would satisfy every assertion above while showing the user nothing. */
  for (const spine of await page.locator('.drill-spine').all()) {
    await expect(spine).toBeVisible();
    const box = await spine.boundingBox();
    expect(box?.width ?? 0, 'a spine rendered with no width').toBeGreaterThan(4);
    expect(box?.height ?? 0, 'a spine rendered with no height').toBeGreaterThan(20);
  }
});
