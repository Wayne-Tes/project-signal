import { expect, test } from '@playwright/test';
import { goToView, presetAppearance, signIn } from './helpers';

/**
 * The Action roadmap, driven as a channel manager would.
 *
 * WHAT THESE GUARD. This page has been wrong twice. First it rendered a fictional bank's
 * hand-written recommendations with invented point-uplifts, under a header claiming an LLM
 * produced them. Then it ranked real clusters honestly but only restated the complaint —
 * *"there's nothing there that is an actual plan on how to fix these things."*
 *
 * The assertions below are therefore about **what the page claims**, not about layout. A component
 * test cannot catch a page that renders a fabricated benchmark, an uncaveated forecast, or a
 * fallback play that reads as advice — every component would still pass its own tests.
 */

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
  await goToView(page, /action roadmap/i);
});

test('states where the target came from, never an unattributed number', async ({ page }) => {
  const headline = page.locator('.chg-headline').first();
  await expect(headline).toBeVisible();

  const text = (await headline.innerText()).toLowerCase();

  /* Either there is no target — which is a legitimate state and must say so — or there is one and
     its provenance is on screen. A bare number with no source is the fabricated "industry
     standard" this whole feature was designed to avoid. */
  const hasTarget = /target of/.test(text);
  if (hasTarget) {
    expect(
      /competitor|strongest scope|set for this brand/.test(text),
      'a target is shown with no stated provenance',
    ).toBe(true);
  } else {
    expect(text).toMatch(/no target yet|no brand perception index/);
  }
});

/**
 * The single most dangerous sentence this page can print. `+3.4 pts` was believed precisely
 * because it looked like a prediction, so the ceiling must never appear without its qualifier.
 */
test('every "if resolved" figure carries its ceiling caveat', async ({ page }) => {
  const worth = page.locator('.rm-worth');
  const count = await worth.count();
  test.skip(count === 0, 'no actions ranked for this brand yet');

  for (let i = 0; i < count; i += 1) {
    const text = await worth.nth(i).innerText();
    if (!/moves the index/i.test(text)) continue;
    expect(text, 'a ceiling was shown without saying it is a ceiling').toMatch(
      /the most it can be worth/i,
    );
    expect(text).toMatch(/assumes nothing about how much is achievable/i);
  }
});

test('a projection never appears without its assumption beside it', async ({ page }) => {
  const sub = page.locator('.rm-sub');
  const count = await sub.count();

  for (let i = 0; i < count; i += 1) {
    const text = await sub.nth(i).innerText();
    if (!/reaches the target in/i.test(text)) continue;
    /* A projection whose assumption is not on screen will be read as a forecast. */
    expect(text).toMatch(/assuming no new signals/i);
    expect(text).toMatch(/a bound, not a forecast/i);
  }
});

test('an action that recommends something says how it will be measured', async ({ page }) => {
  const plays = page.locator('.rm-play');
  const count = await plays.count();
  test.skip(count === 0, 'no play matched for this brand yet');

  const first = plays.first();
  await expect(first.locator('.rm-steps li').first()).toBeVisible();
  /* A measure the roadmap cannot compute is a measure nobody checks. */
  await expect(first.locator('.rm-measure')).toContainText(/how you will know/i);
});

/**
 * A play is not worse for being unevidenced. It is worse for pretending otherwise — a client who
 * catches one invented citation stops believing every number beside it.
 */
test('never claims evidence it does not have', async ({ page }) => {
  const plays = page.locator('.rm-play');
  const count = await plays.count();
  test.skip(count === 0, 'no play matched for this brand yet');

  for (let i = 0; i < count; i += 1) {
    const caveat = plays.nth(i).locator('.rm-caveat');
    const text = await caveat.innerText();

    if (/published source/i.test(text)) {
      /* If it claims a source, the link must actually be there to click. */
      await expect(plays.nth(i).locator('.rm-cite').first()).toBeVisible();
    } else {
      expect(text).toMatch(/not yet backed by a published source/i);
      /* And it must not borrow the language of proof it has not got. */
      expect(text).not.toMatch(/proven|studies show|research shows/i);
    }
  }
});

test('an action opens the evidence behind it', async ({ page }) => {
  const cards = page.locator('.ds-card, .card').filter({ has: page.locator('.rm-worth') });
  test.skip((await cards.count()) === 0, 'no actions ranked for this brand yet');

  await cards.first().click();
  /* Straight to the subject — no fabricated dimension step in the breadcrumb, because the
     roadmap does not know one. */
  await expect(page.locator('.drill-panel:not(.stacked)')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.drill-panel.stacked')).toHaveCount(0);
});
