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
  // The Wave-A seed's derived confirm cards: Taxable Brokerage, Roth IRA,
  // 401(k) (Demo Investor) + Partner Brokerage (Demo Partner) = 4. The
  // cash/savings accounts are MANUAL_BALANCE_TYPES and create no derived card.
  const confirmAll = page.getByRole('button', { name: /^Confirm all \(4\)$/ });
  await expect(confirmAll).toBeVisible({ timeout: 30_000 });
  await confirmAll.click();
  // The section's pre-mounted live region announces the batch result.
  await expect(page.getByText('Confirmed 4 account values.')).toBeVisible({ timeout: 30_000 });
  // Pending set is empty → the batch button unmounts.
  await expect(page.getByRole('button', { name: /^Confirm all/ })).toHaveCount(0);
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('monthly check-in: a scoped Confirm all never ratifies hidden persons’ snapshots', async ({ page }) => {
  const errors = collectErrors(page);
  // Wave-A seed: 3 derived cards owned by Demo Investor (p1), 1 by Demo Partner (p2).
  await page.goto('/monthly?view=p1');
  const confirmP1 = page.getByRole('button', { name: /^Confirm all \(3\)$/ });
  await expect(confirmP1).toBeVisible({ timeout: 30_000 });
  await confirmP1.click();
  await expect(page.getByText('Confirmed 3 account values.')).toBeVisible({ timeout: 30_000 });
  // The partner's pending snapshot MUST survive the scoped batch. Switch the
  // view via the SPA dropdown: the shim persists to IndexedDB on a debounced
  // (250ms) flush, so an immediate goto() can race the flush, load a DB
  // without the writes, and re-seed — the SPA switch stays in the same
  // in-memory DB session.
  await page.getByRole('combobox', { name: 'Filter view by person' }).selectOption('household');
  await expect(page.getByRole('button', { name: /^Confirm all \(1\)$/ })).toBeVisible({ timeout: 30_000 });
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('calculators: the page scope honors ?view= — scoped FI figures + caption, flip via the bar control', async ({ page }) => {
  const errors = collectErrors(page);
  // Cold deep-link in P2 scope (Demo Partner). FI-eligible P2 portfolio =
  // Partner Brokerage 118,000 + Partner Savings 22,000; Joint Checking (8,000)
  // is excluded and declared.
  await page.goto('/calculators?view=p2');
  // exact:true — the Backtest card's "Backtest your portfolio" trigger name
  // also substring-matches 'Portfolio'.
  const portfolio = page.getByLabel('Portfolio', { exact: true });
  await expect(portfolio).toHaveValue('140000', { timeout: 30_000 });
  await expect(
    page.getByText("from Demo Partner's account snapshots — joint accounts not included"),
  ).toBeVisible();
  // Expenses default to the labeled even split of the $6,000 baseline:
  await expect(page.getByLabel('Monthly expenses')).toHaveValue('3000');
  await expect(page.getByText('half your household baseline — even split')).toBeVisible();
  // The FI waymark re-scopes (its meaning names the person):
  await expect(page.getByTestId('path-to-fi-meaning')).toContainText('Demo Partner');
  // Open the card: the exclusions caption carries the counted joint total.
  await page.getByTestId('path-to-fi-trigger').click();
  await expect(page.getByTestId('path-to-fi-scope-exclusions')).toContainText('joint accounts ($8,000)');
  // The header copy is deduped on the grid; the BAR control flips the scope:
  await expect(page.getByRole('combobox', { name: 'Filter view by person' })).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Calculator scope' })
    .getByRole('button', { name: 'Household' })
    .click();
  await expect(portfolio).toHaveValue('935000');
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});
