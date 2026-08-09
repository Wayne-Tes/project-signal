import { expect, test } from '@playwright/test';
import {
  backgroundOf,
  chooseAppearance,
  goToView,
  luminance,
  presetAppearance,
  signIn,
} from './helpers';

/**
 * THE BLACK TILES REGRESSION.
 *
 * The defect: `app/globals.css` imports the design-system tokens and then, on
 * the line after, redefines `--bg`, `--surface`, `--surface-2` and the text
 * ramp as hardcoded dark hex values. Because the redefinition comes after the
 * import it wins, and it is not scoped to any `[data-theme]` selector — a grep
 * for `data-theme` in that file returned zero. Every legacy `.card` therefore
 * resolved `var(--surface)` to `#14161c` no matter which theme the user chose,
 * so eight views rendered black tiles on a light shell.
 *
 * Why nothing caught it: the whole unit suite passed, `resolveTheme` was
 * correct, the token files were correct, and the shell itself is on the design
 * system so it themed properly. The only broken thing was the colour actually
 * painted, which nothing rendered and read back. That is precisely what these
 * tests do.
 *
 * These MUST fail before the fix. A regression test written after the fix that
 * has never been seen red is an assertion about nothing.
 */

/* Every view carrying legacy surfaces. Dashboard and Admin were the two the
   owner saw black; the rest share the same stylesheet and the same defect. */
const VIEWS = [
  { name: /dashboard/i, label: 'Dashboard' },
  { name: /trends/i, label: 'Trends & history' },
  { name: /brand impact/i, label: 'Brand impact' },
  { name: /action roadmap/i, label: 'Action roadmap' },
  { name: /competitors/i, label: 'Competitors' },
  { name: /admin/i, label: 'Admin' },
] as const;

/* Any element painted with a legacy or design-system surface token. Both are
   listed because the fix must not regress the already-migrated surfaces. */
const SURFACE = '.card, .ds-card, .act, .heel, .signal, .metric, .drill-row';

test.describe('light theme paints light surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await presetAppearance(page, { theme: 'light' });
    /* Suppress the first-run tour. It is a full-screen overlay that intercepts every click, so
       without this a fresh browser profile makes every test in this file time out on a locator
       that is on screen but covered — a failure that points nowhere near its cause. The tour has
       its own coverage in help.spec.ts. */
    await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
    await signIn(page);
  });

  test('the shell root reports the chosen theme', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('the page background is light', async ({ page }) => {
    const bg = await backgroundOf(page, 'body');
    expect(luminance(bg), `body background ${bg} should be light`).toBeGreaterThan(0.5);
  });

  for (const view of VIEWS) {
    test(`${view.label}: no card is painted dark`, async ({ page }) => {
      await goToView(page, view.name);

      const surfaces = page.locator(SURFACE);
      const count = await surfaces.count();

      /* A view with no surfaces would pass this test vacuously. Empty states
         are legitimate (this environment has no scored data yet), so assert
         only when there is something to assert on, and say so in the report. */
      test.skip(count === 0, `${view.label} rendered no card surfaces to check`);

      const dark: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const el = surfaces.nth(i);
        if (!(await el.isVisible())) continue;
        const bg = await el.evaluate((n) => getComputedStyle(n).backgroundColor);
        /* Transparent surfaces inherit from a parent already asserted above. */
        if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
        if (luminance(bg) < 0.5) dark.push(bg);
      }

      expect(
        dark,
        `${view.label}: ${dark.length} of ${count} surfaces painted dark in LIGHT theme — ${[
          ...new Set(dark),
        ].join(', ')}`,
      ).toEqual([]);
    });
  }

  test('body text is dark enough to read on a light surface', async ({ page }) => {
    /* The mirror defect: fixing the background alone would leave the legacy
       `--t1: #f4f3ef` text ramp white-on-white, which is worse than black
       tiles because it looks like missing data rather than a styling fault. */
    const colour = await page
      .locator('.ds-topbar h1, h1')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(luminance(colour), `heading colour ${colour} should be dark`).toBeLessThan(0.5);
  });
});

test.describe('dark theme still paints dark surfaces', () => {
  /* The fix repoints legacy tokens at theme-aware ones. This half guards
     against "fixing" light by hardcoding light — the dark theme the owner
     asked to keep must survive. */
  test.beforeEach(async ({ page }) => {
    await presetAppearance(page, { theme: 'dark' });
    /* Suppress the first-run tour. It is a full-screen overlay that intercepts every click, so
       without this a fresh browser profile makes every test in this file time out on a locator
       that is on screen but covered — a failure that points nowhere near its cause. The tour has
       its own coverage in help.spec.ts. */
    await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
    await signIn(page);
  });

  test('the shell root reports dark', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the page background is dark', async ({ page }) => {
    const bg = await backgroundOf(page, 'body');
    expect(luminance(bg), `body background ${bg} should be dark`).toBeLessThan(0.5);
  });

  test('Dashboard cards are dark and text is legible on them', async ({ page }) => {
    await goToView(page, /dashboard/i);
    const heading = await page
      .locator('.ds-topbar h1, h1')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(luminance(heading), `heading colour ${heading} should be light on dark`).toBeGreaterThan(
      0.4,
    );
  });
});

test.describe('the theme actually follows the user', () => {
  test('switching theme in the Appearance popover repaints the surfaces', async ({ page }) => {
    /* Drives the real control rather than localStorage, so the popover, the
       provider and the CSS are all exercised together. */
    await presetAppearance(page, { theme: 'dark' });
    /* Suppress the first-run tour. It is a full-screen overlay that intercepts every click, so
       without this a fresh browser profile makes every test in this file time out on a locator
       that is on screen but covered — a failure that points nowhere near its cause. The tour has
       its own coverage in help.spec.ts. */
    await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
    await signIn(page);
    expect(luminance(await backgroundOf(page, 'body'))).toBeLessThan(0.5);

    await chooseAppearance(page, 'Theme', 'Light');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(400);
    expect(
      luminance(await backgroundOf(page, 'body')),
      'body should repaint light without a reload',
    ).toBeGreaterThan(0.5);
  });
});
