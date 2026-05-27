/**
 * Large-data stress test for the virtualized SpendingTransactions page.
 *
 * Seeds the database with 25,000 transactions (a realistic upper bound for
 * a friend with ~4 years of multi-card statement imports), mounts the page,
 * and asserts:
 *
 *   1. Only a small window of <tr>s is mounted at any moment (proves the
 *      virtualizer is actually clipping the DOM, not just paginating in
 *      memory). 50 is the upper bound — the page renders ~22 visible rows
 *      + OVERSCAN of 8 above and below, plus 2 spacer rows.
 *   2. Mount completes in under 500ms in jsdom (real WebKit will be 3-4×
 *      faster than jsdom for DOM ops, so this is a conservative bound).
 *
 * Coordinated with the testing teammate's STRESS=1 gate convention from
 * docs/reviews/2026-05-27-testing-wave3.md §N4. Until that vitest.config
 * gate lands, this file gates itself via the same STRESS env var — passing
 * `STRESS=1 npm test` runs it; the default `npm test` skips. Keeps the
 * baseline 3106 unaffected while still committing the regression bar.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { TransactionsRepo } from '@/domain/transactions';
import SpendingTransactions from '@/pages/SpendingTransactions';
import type { Transaction } from '@/types/schema';

const stressEnabled = process.env.STRESS === '1';
const dscribe = stressEnabled ? describe : describe.skip;

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/spending/transactions']}>
      <Routes>
        <Route path="/spending/transactions" element={<SpendingTransactions />} />
        <Route path="/spending" element={<div data-testid="spending-stub">Spending stub</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const mkTxn = (over: Partial<Omit<Transaction, 'id'>> = {}): Omit<Transaction, 'id'> => ({
  householdId: 1,
  date: '2026-03-05',
  merchant: 'AMAZON',
  merchantRaw: 'AMAZON.COM',
  amount: 54.23,
  categoryId: 37,
  sourceAccountId: null,
  propertyId: null,
  vehicleId: null,
  personId: null,
  sourcePdfFilename: 'mar.pdf',
  reimbursable: false,
  reimbursedAt: null,
  reimbursedAmount: null,
  isRecurring: false,
  notes: null,
  ...over,
});

dscribe('SpendingTransactions stress', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0003_add_commission_columns'),
      mig('0005_add_employment_and_bonus_columns'),
      mig('0007_add_account_margin'),
      mig('0008_add_transaction_property_links'),
      mig('0012_add_transaction_person'),
      mig('0009_seed_categories'),
      mig('0010_seed_merchant_mappings'),
      mig('0013_add_category_budget'),
      mig('0014_add_app_settings'),
      mig('0015_add_accent_colors'),
      mig('0024_cash_apy'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  // Generous overall test timeout — seeding 25 k rows + better-sqlite3
  // transaction overhead can take a few seconds even with the
  // bulk-insert optimization in TransactionsRepo.createMany(). The
  // *mount* assertion below is the actual perf signal (must be <500ms);
  // this timeout just keeps the seeding phase from killing the test.
  it('mounts 25,000 transactions in <500ms and keeps DOM <50 rows', { timeout: 60_000 }, async () => {
    await useCategoriesStore.getState().load();

    // Seed 25,000 transactions in one insert batch (covered by the
    // optimization migration 0034). Vary the date so the sort path is
    // exercised and we don't accidentally test a no-op.
    const repo = new TransactionsRepo(db);
    const rows: Array<Omit<Transaction, 'id'>> = [];
    for (let i = 0; i < 25000; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      const month = String(((Math.floor(i / 28)) % 12) + 1).padStart(2, '0');
      const year = 2020 + Math.floor(i / (28 * 12));
      rows.push(
        mkTxn({
          merchant: `MERCH_${i}`,
          amount: (i % 100) + 0.99,
          date: `${year}-${month}-${day}`,
        }),
      );
    }
    await repo.createMany(rows);
    await useTransactionsStore.getState().load();

    const t0 = performance.now();
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /all transactions/i })).toBeInTheDocument();
    });
    // Wait for the virtualizer's first layout pass — measured by at least
    // one data row appearing in the table.
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    });
    const mountMs = performance.now() - t0;

    const table = screen.getByRole('table');
    // Count tbody rows — this includes the two aria-hidden spacer rows
    // the virtualizer uses for scroll-height padding. The actual rendered
    // transaction-data rows is bodyRows - 2 in the steady state.
    const bodyRows = table.querySelectorAll('tbody tr').length;

    expect(bodyRows).toBeLessThan(50);
    expect(mountMs).toBeLessThan(500);
    // Also assert the page actually has 25k rows logically — the count
    // strip in the header is the source of truth for "we did NOT slice
    // the dataset, we just clipped the DOM".
    expect(screen.getByText(/25,?000 transactions/i)).toBeInTheDocument();
  });
});
