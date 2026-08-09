import { expect, test, type Page } from '@playwright/test';
import { goToView, presetAppearance, signIn } from './helpers';

/**
 * Brand and product management, driven end to end.
 *
 * THE REGRESSION THIS GUARDS. Editing a product was an icon-only ghost pencil sitting between a
 * name and a badge. Every unit test passed, the control worked, and the owner — who had just added
 * sixteen products — reported there was no edit option. An affordance nobody can find is not a
 * feature; and no assertion in the repository could tell the difference, because all of them
 * looked the element up by an accessible name that was visually hidden.
 *
 * So this spec asks for the control the way a person does: a button with the WORD "Edit" on it. It
 * then drives the whole round trip — create, rename, delete — against a real API and a real
 * database, which is the only thing that proves the delete route's dependency checks let a
 * genuinely-empty entity through.
 *
 * SELF-CLEANING. The entity it creates is named with a fixed marker and removed by the last test;
 * a `beforeAll` sweep also removes anything a previous crashed run left behind, so a failure never
 * poisons the next run or leaves rubbish in a shared environment.
 */

/** Distinctive enough that it can never collide with a real brand. */
const TEMP = 'ZZ E2E Scratch Entity';

/** Removes any leftover scratch rows, whatever state a previous run died in. */
async function sweep(page: Page): Promise<void> {
  await goToView(page, /admin/i);
  const list = page.locator('.ds-card', { hasText: 'Brands and products' });
  for (let guard = 0; guard < 5; guard += 1) {
    const stale = list.getByRole('button', { name: `Delete ${TEMP}` });
    if ((await stale.count()) === 0) return;
    await stale.first().click();
    await list.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(stale).toHaveCount(0, { timeout: 15_000 });
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await presetAppearance(page, { theme: 'light' });
  /* The tour is a full-screen overlay that intercepts clicks; covered in help.spec.ts. */
  await page.addInitScript(() => window.localStorage.setItem('ps_tour_completed', '1'));
  await signIn(page);
});

test('every row offers a visibly labelled Edit button', async ({ page }) => {
  await goToView(page, /admin/i);
  const list = page.locator('.ds-card', { hasText: 'Brands and products' });
  const edit = list.getByRole('button', { name: 'Edit' }).first();

  await expect(edit).toBeVisible();
  /* Not merely present in the accessibility tree — actually rendering as text. The previous
     version satisfied every name-based query while showing nothing but a faint pencil. */
  await expect(edit).toHaveText(/Edit/);
});

test('creates, renames and deletes a product', async ({ page }) => {
  await sweep(page);
  const list = page.locator('.ds-card', { hasText: 'Brands and products' });

  await page.locator('#entityName').fill(TEMP);
  await page.locator('#entityKind').selectOption('product');
  await list.getByRole('button', { name: 'Add' }).click();

  const row = list.locator('li', { hasText: TEMP });
  await expect(row).toBeVisible({ timeout: 15_000 });

  /* Rename. This is the remedy for a wrong name, and the reason delete refuses once signals
     exist: the history is worth more than the typo. */
  await row.getByRole('button', { name: 'Edit' }).click();
  const renamed = `${TEMP} Renamed`;
  await page.getByLabel(`Name of ${TEMP}`).fill(renamed);
  await page.getByRole('button', { name: 'Save' }).click();

  const after = list.locator('li', { hasText: renamed });
  await expect(after).toBeVisible({ timeout: 15_000 });

  /* Ownership round-trips too, and shows up in the badge rather than only in the request. */
  await after.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel(`Ownership of ${renamed}`).selectOption('competitor');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(list.locator('li', { hasText: renamed })).toContainText('competitor', {
    timeout: 15_000,
  });

  /* Delete takes two clicks. The first must not remove anything. */
  const target = list.locator('li', { hasText: renamed });
  await target.getByRole('button', { name: `Delete ${renamed}` }).click();
  await expect(target).toBeVisible();

  await target.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(list.locator('li', { hasText: renamed })).toHaveCount(0, { timeout: 15_000 });
});

test('refuses to delete an entity that has collected signals, and says why', async ({ page }) => {
  /* The root brand has real signals behind it, so this exercises the blocker against live data
     rather than a mock — the check that stops a misclick discarding collected intelligence. */
  await goToView(page, /admin/i);
  const list = page.locator('.ds-card', { hasText: 'Brands and products' });
  const first = list.locator('li').first();

  const label = await first.locator('span').first().innerText();
  await first.getByRole('button', { name: `Delete ${label}` }).click();
  await first.getByRole('button', { name: 'Confirm delete' }).click();

  /* Whichever blocker fires, the message must name it. "Cannot delete" alone sends someone to a
     database they have no access to. */
  await expect(list.getByRole('alert')).toContainText(/because .+/, { timeout: 15_000 });
  await expect(list.locator('li', { hasText: label })).toHaveCount(1);
});
