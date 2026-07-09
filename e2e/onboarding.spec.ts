import { test, expect } from '@playwright/test';
import { collectErrors } from './console-guard';

/**
 * T26: the real onboarding happy path on a FRESH (unseeded) browser-shim DB.
 * The seeded suite boots straight into the app shell (disclosures accepted,
 * demo data present) and can never exercise setup; this project points at the
 * :1423 server started WITHOUT VITE_SEED_DEMO, so IndexedDB is empty and boot
 * lands on the disclaimer + Setup Wizard. One end-to-end walk: accept → add a
 * person → advance the sections → finish → reach the app shell, clean console.
 */
test('fresh profile: disclaimer → setup → app shell, clean console', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  // 1. The branded welcome frame (T23) above the app-wide disclaimer.
  await expect(page.getByRole('heading', { name: /welcome to cairn/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: 'Disclaimer' })).toBeVisible();

  // 2. Accept and continue to setup.
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /continue to setup/i }).click();

  // 3. Section 1 — start it, then add one person via the dialog.
  await expect(page.getByRole('heading', { name: /Section 1 of 4/i })).toBeVisible();
  await page.getByRole('button', { name: /start this section/i }).click();

  const personsCard = page
    .getByText('Persons', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
  await personsCard.getByRole('button', { name: /add manually/i }).click();

  await page.getByLabel('Name', { exact: true }).fill('Alex Rivera');
  await page.getByLabel('Date of birth year').selectOption({ label: '1990' });
  await page.getByLabel('Date of birth month').selectOption({ label: 'Jan' });
  await page.getByLabel('Date of birth day').selectOption({ label: '01' });
  await page.getByLabel(/annual salary/i).fill('120000');
  await page.getByRole('button', { name: /add person/i }).click();

  // The person renders as a chip (T23).
  await expect(page.getByTestId('person-chips').getByText('Alex Rivera')).toBeVisible();

  // 4. Advance through the remaining sections. Section 1 → completed; skip 2 & 3.
  await page.getByRole('button', { name: /next section/i }).click();
  await expect(page.getByRole('heading', { name: /Section 2 of 4/i })).toBeVisible();
  await page.getByRole('button', { name: /skip — none of this applies/i }).click();
  await expect(page.getByRole('heading', { name: /Section 3 of 4/i })).toBeVisible();
  await page.getByRole('button', { name: /skip — none of this applies/i }).click();
  await expect(page.getByRole('heading', { name: /Section 4 of 4/i })).toBeVisible();

  // 5. Finish → the post-setup "You're set up" beat → into the app shell.
  await page.getByRole('button', { name: /finish setup/i }).click();
  await expect(page.getByRole('heading', { name: /you're set up/i })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: /skip setup help/i }).click();

  // 6. The app shell (primary nav) renders — setup completed cleanly.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors.join('\n')).not.toContain('Maximum update depth');
  expect(errors).toEqual([]);
});
