import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectErrors } from './console-guard';

// ESM spec (no __dirname) — derive the fixtures dir from this module's URL.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Flow coverage past boot smoke (wave-7 W7): each test drives a real store
 * mutation through the sql.js shim — a scenario-lever write, a CSV import
 * commit batch, and a Monthly confirm-all upsert. Fresh browser context per
 * test ⇒ fresh IndexedDB ⇒ the demo seed re-runs deterministically.
 * Anything Tauri-IPC-only (native dialogs, plugin-http market refresh,
 * notifications) stays off-limits in the shim — none is touched here.
 */

test('what-if: seeded scenario renders; the Loans lever applies an extra payment end-to-end', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/what-if');
  // Scenarios store seeds a Baseline on empty — the page must not be in the
  // "No active scenario" state.
  await expect(page.getByTestId('whatif-projection-chart-wrap')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('whatif-fi-cards-wrap')).toBeVisible();

  await page.getByRole('button', { name: 'Loans' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // First row = seeded Mortgage ($540k @ 6.25%, $4,001/mo — healthy, so the
  // classic preview line renders, not the wave-7 never-pays-off note).
  await dialog.getByLabel(/extra \/ mo/i).first().fill('200');
  await expect(dialog.getByText(/Payoff:/).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();

  // The lever persisted through the shim DB: the pill re-renders with its
  // count badge (accessible name stays 'Loans' via aria-label).
  await expect(page.getByRole('button', { name: 'Loans' })).toContainText('Loans · 1');
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('spending: CSV import round-trips — file in, preview commit, transactions on the page', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/spending');
  // Native <input type="file"> (no Tauri dialog in the CSV path) — visible
  // or not, setInputFiles targets it directly.
  await page
    .locator('input[type="file"][aria-label="Transactions PDF or CSV"]')
    .setInputFiles(path.resolve(HERE, 'fixtures', 'transactions.csv'));
  await page.getByRole('button', { name: /^Commit \(2 rows\)$/ }).click();

  // Committed rows land in the Recent-transactions table (cell role scopes
  // away the Top-merchants chart, which renders the same strings in SVG;
  // exact:true scopes away the row's "Edit <merchant>" button cell).
  await expect(page.getByRole('cell', { name: 'Blue Bottle Coffee', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('cell', { name: 'Trader Joes', exact: true })).toBeVisible();
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('monthly check-in: Confirm all ratifies the seeded last-month values', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/monthly');
  // Task 13 seeds one AUTO_DERIVED last-month-close snapshot per account (3).
  const confirmAll = page.getByRole('button', { name: /^Confirm all \(3\)$/ });
  await expect(confirmAll).toBeVisible({ timeout: 30_000 });
  await confirmAll.click();
  // The section's pre-mounted live region announces the batch result.
  await expect(page.getByText('Confirmed 3 account values.')).toBeVisible({ timeout: 30_000 });
  // Pending set is empty → the batch button unmounts.
  await expect(page.getByRole('button', { name: /^Confirm all/ })).toHaveCount(0);
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});
