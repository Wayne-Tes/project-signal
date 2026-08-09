import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration — the repository's first end-to-end harness.
 *
 * WHY THIS EXISTS. DEVRULES.md requires front-end work to be driven like a real
 * user, and recorded that this repo had "no committed e2e harness ... browser
 * verification is therefore MCP-driven and leaves no regression artefact
 * behind". That gap let a whole class of defect through: the light-theme cards
 * rendered black on eight views, every unit test passed, and it was only caught
 * by a person looking at the screen. A test that renders the app and reads
 * computed styles is the only thing that catches it.
 *
 * WHERE IT RUNS. `baseURL` comes from E2E_BASE_URL so the same suite can drive
 * a local `next dev` or a deployed environment. It defaults to localhost rather
 * than to the deployed URL deliberately — a suite that silently points at a
 * shared environment is one `--update-snapshots` away from being a write
 * against it.
 *
 * BROWSERS. Chromium only. The product is an internal analytical dashboard, and
 * a matrix of three engines would treble the runtime for defects this product
 * will never see. Add WebKit when there is a user on it, not before.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** True when driving a deployed environment rather than a local dev server. */
const isRemote = !baseURL.includes('localhost') && !baseURL.includes('127.0.0.1');

export default defineConfig({
  testDir: './e2e',
  /* A cold Next dev compile of a route can exceed the 30s default. */
  /* Deliberately tight. The first full run took over an hour because a full-screen overlay
     covered every locator and each test burned its whole 90s budget waiting. A suite that takes
     an hour to tell you something simple is a suite nobody runs. */
  timeout: 45_000,
  expect: { timeout: 10_000 },

  /* Serial locally, so a failure is reproducible; parallel is a false economy
     on a suite this size and makes trace reading harder. */
  fullyParallel: false,
  workers: 1,

  /* Never allow a committed `test.only` to silently narrow CI to one test. */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    /* Traces and screenshots only on failure: they are the artefact that makes
       a CI failure diagnosable without re-running locally. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1600, height: 950 },
    /* The dev ALB is plain HTTP with no certificate; ignore rather than fail. */
    ignoreHTTPSErrors: true,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /* Only manage a server when driving localhost. Against a deployed URL there
     is nothing to start, and starting one would shadow the thing under test. */
  webServer: isRemote
    ? undefined
    : {
        command: 'yarn dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
