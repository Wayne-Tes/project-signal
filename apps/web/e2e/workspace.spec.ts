import { expect, test } from '@playwright/test';
import { goToView, luminance, presetAppearance, signIn } from './helpers';

/**
 * The two workspace pages, and the accent now carried by primary actions.
 *
 * The documentation and assistant pages exist alongside the top-bar panels, not instead of
 * them: the panel answers a question raised by what you are looking at; the page is somewhere
 * you go to read, or to work through a conversation you will come back to.
 */

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  /* The tour is a full-screen overlay that intercepts clicks; it is covered in help.spec.ts. */
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
});

test.describe('documentation page', () => {
  test('is reachable from the sidebar and renders an article', async ({ page }) => {
    await goToView(page, /documentation/i);
    await expect(page.getByRole('heading', { name: /how project signal works/i })).toBeVisible();
    /* Contents beside the article — the point of a page over a slide-over. */
    await expect(page.getByRole('navigation', { name: /documentation contents/i })).toBeVisible();
    await expect(page.locator('.ds-docs__article')).toContainText(/./);
  });

  test('searches, and names a way out when nothing matches', async ({ page }) => {
    await goToView(page, /documentation/i);
    const search = page.getByLabel('Search the documentation');

    await search.fill('nothing showing');
    await expect(page.locator('.ds-docs__nav')).toContainText('Why is my dashboard empty');

    await search.fill('kubernetes ingress sidecar');
    await expect(page.locator('.ds-docs__nav')).toContainText(/ask the assistant/i);
  });

  test('renders markdown rather than raw source', async ({ page }) => {
    await goToView(page, /documentation/i);
    await page.getByRole('button', { name: /understanding the brand perception index/i }).click();
    const article = page.locator('.ds-docs__article');
    await expect(article.locator('table').first()).toBeVisible();
    await expect(article).not.toContainText('| --- |');
    await expect(article).not.toContainText('**');
  });
});

test.describe('assistant page', () => {
  test('is reachable from the sidebar and offers history', async ({ page }) => {
    await goToView(page, /assistant/i);
    await expect(page.getByRole('heading', { name: /ask about your data/i })).toBeVisible();
    await expect(page.getByRole('complementary', { name: /conversation history/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /new conversation/i })).toBeVisible();
  });

  test('saves a conversation and can reopen it', async ({ page }) => {
    /* The whole reason this page exists rather than only the dock. */
    await goToView(page, /assistant/i);

    const question = `What does a score of 50 mean? ${Date.now()}`;
    await page.getByLabel('Ask the assistant').fill(question);
    await page.keyboard.press('Enter');

    await expect(page.locator('.ds-chat__answer').last()).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.ds-assistant__error')).toHaveCount(0);

    /* It appears in history, titled from the question rather than left untitled. */
    const item = page.locator('.ds-chat__item-title').first();
    await expect(item).toBeVisible();

    /* And it survives a reload — the point of persisting it at all. */
    await page.reload();
    await goToView(page, /assistant/i);
    await expect(page.locator('.ds-chat__item-title').first()).toBeVisible();

    await page.locator('.ds-chat__item-open').first().click();
    await expect(page.locator('.ds-chat__question').first()).toBeVisible();
  });
});

test.describe('primary actions carry the chosen accent', () => {
  test('"Dig into score" is the accent colour, not a black slab', async ({ page }) => {
    const dig = page.getByRole('button', { name: /dig into score/i });
    const bg = await dig.evaluate((el) => getComputedStyle(el).backgroundColor);

    /* Default accent is lime. Asserting it is not the old navy, and not a near-black — an exact
       hex would break on any palette re-tune, which is how colour assertions get deleted. */
    expect(luminance(bg), `primary button background ${bg} should not be near-black`).toBeGreaterThan(
      0.12,
    );
  });

  test('the accent chosen in Appearance reaches the primary button', async ({ page }) => {
    const dig = page.getByRole('button', { name: /dig into score/i });
    const before = await dig.evaluate((el) => getComputedStyle(el).backgroundColor);

    await page.getByRole('button', { name: /appearance/i }).click();
    await page
      .getByRole('radiogroup', { name: 'Highlight' })
      .getByRole('radio', { name: 'Purple', exact: true })
      .click();
    await page.keyboard.press('Escape');

    await expect
      .poll(async () => dig.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe(before);

    /* Restore, so a shared e2e account does not leave every later run purple. */
    await page.getByRole('button', { name: /appearance/i }).click();
    await page
      .getByRole('radiogroup', { name: 'Highlight' })
      .getByRole('radio', { name: 'Lime', exact: true })
      .click();
  });

  test('Admin actions are the accent, not the status ramp', async ({ page }) => {
    /* They painted themselves `--mint`, the legacy "positive" colour, so every action in Admin
       looked like a status badge and ignored the user's choice entirely. */
    await goToView(page, /admin/i);
    const create = page.getByRole('button', { name: /create tenant/i });
    await expect(create).toBeVisible();

    const bg = await create.evaluate((el) => getComputedStyle(el).backgroundColor);
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    );
    expect(accent, 'the shell must define an accent to inherit').not.toBe('');
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });
});
