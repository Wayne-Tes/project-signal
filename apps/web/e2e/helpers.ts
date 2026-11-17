import { expect, type Page } from '@playwright/test';

/**
 * Shared e2e helpers.
 *
 * Kept deliberately small. A fixture layer that abstracts the UI away is how
 * e2e suites stop testing the UI — every helper here either drives a real
 * control or reads a real computed value.
 */

/**
 * Which sign-in the app under test uses.
 *
 * `local` drives the API's local-development sign-in (username + password, the build has
 * NEXT_PUBLIC_AUTH_MODE=local). `cognito` drives the real pool. Set explicitly with
 * E2E_AUTH_MODE; inferred as `local` when E2E_USERNAME is given, because that variable only
 * exists for local mode.
 */
export function authMode(): 'local' | 'cognito' {
  const explicit = process.env.E2E_AUTH_MODE;
  if (explicit === 'local' || explicit === 'cognito') return explicit;
  return process.env.E2E_USERNAME ? 'local' : 'cognito';
}

/**
 * Credentials for the e2e account. Never defaulted — see the throw below.
 *
 * Local mode reads E2E_USERNAME (a seeded local account); Cognito mode reads E2E_EMAIL. Both read
 * E2E_PASSWORD. The returned `identifier` is whichever applies.
 */
export function credentials(): { identifier: string; password: string } {
  const identifier = authMode() === 'local' ? process.env.E2E_USERNAME : process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!identifier || !password) {
    /* Failing loudly beats silently skipping. A suite that quietly no-ops when
       a variable is missing reports green while testing nothing, which is the
       failure mode this harness exists to prevent. */
    throw new Error(
      authMode() === 'local'
        ? 'E2E_USERNAME and E2E_PASSWORD must be set for local mode. The local test accounts and ' +
            'their password are in the root .env (LOCAL_AUTH_PASSWORD). See apps/web/e2e/README.md.'
        : 'E2E_EMAIL and E2E_PASSWORD must be set. They are not committed: the e2e ' +
            'user is created per environment. See apps/web/e2e/README.md.',
    );
  }
  return { identifier, password };
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

/** sessionStorage key of the local-mode session — `src/lib/local-auth.ts`. */
const LOCAL_SESSION_KEY = 'ps.local-session';

/**
 * The local session from this worker's first real sign-in, replayed into every later test.
 *
 * WHY. `POST /auth/local/sign-in` is rate-limited to 10 attempts a minute per address — a
 * brute-force guard on a password endpoint, and the right limit. The suite signs in for every test,
 * so typing the password each time tripped the guard partway through the run and a third of the
 * suite failed on "Too many sign-in attempts". The sign-in FORM is still driven for real: once per
 * worker here, and by every test in local-auth.spec.ts, which passes `{ viaForm: true }`.
 *
 * Cognito mode is unaffected: its session lives in Amplify's storage and is always signed in
 * through the form.
 */
let localSession: string | null = null;

/** Signs in and waits for the shell. Throws rather than returning a bad state. */
export async function signIn(page: Page, opts: { viaForm?: boolean } = {}): Promise<void> {
  const nav = page.locator('nav[aria-label="Main"]');
  const reuse = authMode() === 'local' && !opts.viaForm ? localSession : null;
  if (reuse) {
    /* Before any app script runs, so the shell boots already signed in. */
    await page.addInitScript(
      ([key, value]) => {
        if (!window.sessionStorage.getItem(key)) window.sessionStorage.setItem(key, value);
      },
      [LOCAL_SESSION_KEY, reuse] as const,
    );
  }

  const { identifier, password } = credentials();
  await page.goto('/');

  /* An already-authenticated context lands straight on the shell. */
  if (reuse) await expect(nav).toBeVisible({ timeout: 30_000 });
  if (await nav.isVisible().catch(() => false)) return;

  /* One field id for both modes — its label is "Email" or "Username". */
  await page.locator('#identifier').fill(identifier);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(nav).toBeVisible({ timeout: 30_000 });

  if (authMode() === 'local') {
    localSession = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      LOCAL_SESSION_KEY,
    );
  }
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
  return page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
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
  /* Wait for the group before reaching into it. The popover animates in, and clicking during
     the entrance can land on a position the element has since left — Playwright's actionability
     checks cover a moving target, but not one whose ancestor is still being inserted. */
  await expect(popover).toBeVisible();
  await popover.getByRole('radio', { name: option, exact: true }).click();
}

/**
 * The top bar's page title.
 *
 * It is an `h2`, not an `h1` — the shell has no h1 at all. Selecting `h1` matched nothing and
 * every assertion on it died on a 45-second timeout rather than saying "no such element".
 */
export const TOPBAR_TITLE = '.ds-topbar__title';

/**
 * Opens the help centre AT ITS INDEX.
 *
 * Clicking Help lands on the CURRENT VIEW's article, which is the contextual-help behaviour the
 * panel is built for and is asserted separately. Reaching the index therefore needs the "All
 * articles" step — a test that assumes the index without it waits for a search box that is not
 * on screen, and fails on a timeout that says nothing about the cause.
 */
export async function openHelpIndex(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^help$/i }).click();
  const back = page.getByRole('button', { name: /all articles/i });
  if (await back.isVisible().catch(() => false)) await back.click();
  await expect(page.getByLabel('Search help')).toBeVisible();
}
