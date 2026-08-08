import { expect, type Page } from '@playwright/test';

/**
 * Shared e2e helpers.
 *
 * Kept deliberately small. A fixture layer that abstracts the UI away is how
 * e2e suites stop testing the UI — every helper here either drives a real
 * control or reads a real computed value.
 */

/** Credentials for the e2e account. Never defaulted — see the throw below. */
export function credentials(): { email: string; password: string } {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    /* Failing loudly beats silently skipping. A suite that quietly no-ops when
       a variable is missing reports green while testing nothing, which is the
       failure mode this harness exists to prevent. */
    throw new Error(
      'E2E_EMAIL and E2E_PASSWORD must be set. They are not committed: the e2e ' +
        'user is created per environment. See apps/web/e2e/README.md.',
    );
  }
  return { email, password };
}

/**
 * Forces an appearance preference before the app boots.
 *
 * Written straight to localStorage rather than clicked through the Appearance
 * popover because the theme must be in place BEFORE first paint — the boot
 * script in layout.tsx reads these keys to avoid a flash of the wrong theme,
 * and clicking afterwards would test the transition rather than the theme.
 * The popover itself is covered separately in shell.spec.ts.
 */
export async function presetAppearance(
  page: Page,
  prefs: { theme?: 'light' | 'dark' | 'system'; sidebar?: 'light' | 'navy'; accent?: string },
): Promise<void> {
  await page.addInitScript((p: typeof prefs) => {
    if (p.theme) window.localStorage.setItem('ps_theme', p.theme);
    if (p.sidebar) window.localStorage.setItem('ps_sidebar', p.sidebar);
    if (p.accent) window.localStorage.setItem('ps_accent', p.accent);
  }, prefs);
}

/** Signs in and waits for the shell. Throws rather than returning a bad state. */
export async function signIn(page: Page): Promise<void> {
  const { email, password } = credentials();
  await page.goto('/');

  /* An already-authenticated context lands straight on the shell. */
  const nav = page.locator('nav[aria-label="Main"]');
  if (await nav.isVisible().catch(() => false)) return;

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(nav).toBeVisible({ timeout: 30_000 });
}

/** Navigates via the real sidebar link, as a user would. */
export async function goToView(page: Page, name: RegExp | string): Promise<void> {
  await page.locator('nav[aria-label="Main"]').getByRole('button', { name }).click();
  /* Entrance animations run for --dur-enter; settle before reading styles. */
  await page.waitForTimeout(600);
}

/**
 * Relative luminance (WCAG) of a CSS colour string, 0 (black) to 1 (white).
 *
 * Used instead of asserting an exact hex so the test survives a palette
 * re-tune: what matters is that a light theme paints light surfaces, not that
 * a card is precisely #ffffff. An exact-value assertion would have to be
 * rewritten every time a designer moves a grey, and would eventually be
 * deleted for being noisy.
 */
export function luminance(css: string): number {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m || !m[1]) return Number.NaN;
  const parts = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
  const [r, g, b] = parts as [number, number, number];
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The computed background of the first match, resolved through custom properties. */
export async function backgroundOf(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

/**
 * Opens the Appearance popover and picks one option from a named group.
 *
 * Both `Segmented` and `SwatchPicker` render `role="radio"` inside a labelled
 * `role="radiogroup"` — not buttons. Scoping by the group is not tidiness: the
 * label "Light" appears in BOTH the Theme and the Sidebar group, so an
 * unscoped lookup is ambiguous and resolves to whichever renders first, which
 * would silently test the wrong control.
 */
export async function chooseAppearance(page: Page, group: string, option: string): Promise<void> {
  const trigger = page.getByRole('button', { name: /appearance/i });
  const popover = page.getByRole('radiogroup', { name: group });
  if (!(await popover.isVisible().catch(() => false))) await trigger.click();
  await popover.getByRole('radio', { name: option, exact: true }).click();
}
