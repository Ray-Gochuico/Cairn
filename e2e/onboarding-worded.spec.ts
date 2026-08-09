import { test, expect } from '@playwright/test';
import { collectErrors } from './console-guard';

/**
 * The worded-flow default-path pin (worded-onboarding wave): married branch,
 * one account WITH the new balance field via the accounts gate, "no" gates,
 * spec-verbatim CW strings asserted along the way. Runs on the fresh-DB
 * project (:1423) per D-WF16.
 */
test('fresh profile (worded default): married branch, account with balance, no-gates → data lands, clean console', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /welcome to cairn/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /continue to setup/i }).click();

  // Part 1 — About you (worded is the DEFAULT: no toggle click)
  await expect(page.getByRole('heading', { name: 'About you — step 1 of 5' })).toBeVisible();
  await page.getByLabel('Your name').fill('Alex Rivera');
  await page.getByLabel('Your date of birth year').selectOption('1990');
  await page.getByLabel('Your date of birth month').selectOption({ label: 'May' });
  await page.getByLabel('Your date of birth day').selectOption('01');
  await page.getByRole('button', { name: 'Next' }).click();

  // 1b — the married branch (reveals in place, partner drafted not created)
  await expect(page.getByRole('heading', { name: 'About you — step 2 of 5' })).toBeVisible();
  await page.getByRole('radio', { name: 'Yes' }).check();
  await page.getByRole('radio', { name: 'Jointly' }).check();
  await page.getByLabel("Your partner's name").fill('Sam Rivera');
  await page.getByLabel("Your partner's date of birth year").selectOption('1991');
  await page.getByLabel("Your partner's date of birth month").selectOption({ label: 'Feb' });
  await page.getByLabel("Your partner's date of birth day").selectOption('03');
  await page.getByRole('button', { name: 'Next' }).click();

  // 1c — state (the CW-20 question labels the input)
  await page.getByLabel('Which state do you live in?').fill('CA');
  await page.getByRole('button', { name: 'Next' }).click();

  // 1d — dependents gate: No, consequence renders
  await page.getByRole('radio', { name: 'No' }).check();
  await expect(page.getByText(
    'Nothing is recorded — dependents can be added any time under Inputs → Dependents.',
  )).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // 1e — expenses
  await page.getByLabel('About how much does your household spend in a month?').fill('4000');
  await page.getByRole('button', { name: 'Next' }).click();

  // Part 2 — you, then partner (role blocks; 6 steps for a couple)
  await expect(page.getByRole('heading', { name: 'Work & pay — step 1 of 6' })).toBeVisible();
  await page.getByRole('radio', { name: 'Salary', exact: true }).check();
  await page.getByLabel('Annual salary (pre-tax)').fill('95000');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Target retirement age').fill('67');
  await page.getByRole('button', { name: 'Next' }).click();   // ← Alex's row is created HERE
  await page.getByRole('button', { name: 'Skip these' }).click();
  await expect(page.getByRole('heading', { name: 'Work & pay — step 4 of 6' })).toBeVisible();
  await page.getByRole('radio', { name: 'Salary', exact: true }).check();
  await page.getByLabel('Annual salary (pre-tax)').fill('80000');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Target retirement age').fill('66');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Skip these' }).click();

  // Part 3 — accounts gate: yes + one account WITH the new balance field
  await expect(page.getByRole('heading', { name: 'What you own — step 1 of 4' })).toBeVisible();
  await page.getByRole('radio', { name: 'Yes' }).check();
  await page.getByRole('button', { name: /add manually/i }).click();
  await page.getByLabel('Current balance — optional').fill('12500');
  await page.getByLabel('Name', { exact: true }).fill('Joint checking');
  await page.getByRole('button', { name: 'Add Account' }).click();
  await expect(page.getByText('Joint checking')).toBeVisible(); // the chip
  await page.getByRole('button', { name: 'Next' }).click();

  // home No → rent appears → No → vehicles No → equity No
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole('radio', { name: 'No' }).check();
    await page.getByRole('button', { name: 'Next' }).click();
  }

  // Part 4 — loans gate carries the no-judgment sentence
  await expect(page.getByTestId('flow-loans-intro')).toHaveText(
    'Listing what you owe is just for an accurate picture — there is no judgment here.',
  );
  await page.getByRole('radio', { name: 'No' }).check();
  await page.getByRole('button', { name: 'Next' }).click();

  // Part 5 — import No (spec-verbatim consequence), goals No
  await page.getByRole('radio', { name: 'No' }).check();
  await expect(page.getByText('You can always do this later on the Spending page.')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'No' }).check();
  await page.getByRole('button', { name: 'Next' }).click();

  // Finish → /welcome (fresh run: tailor NOT done)
  await expect(page.getByRole('heading', { name: "That's everything." })).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: /you're set up/i })).toBeVisible();
  await page.getByRole('button', { name: /skip setup help/i }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  // The data landed in the real cells (dashboard/app shows it)
  await page.goto('/inputs/persons');
  await expect(page.getByText('Alex Rivera').first()).toBeVisible();
  await expect(page.getByText('Sam Rivera').first()).toBeVisible();
  await page.goto('/investments?manage=accounts');
  await expect(page.getByText('Joint checking').first()).toBeVisible();

  // Smoke D1 pin: the MARRIED filing status must read back from the
  // PERSISTED household row on the normal Inputs form — the cell, not the
  // flow's own echo.
  await page.goto('/inputs/household');
  await expect(page.getByLabel('Filing status')).toContainText('Married Filing Jointly');

  expect(errors).toEqual([]);
});
