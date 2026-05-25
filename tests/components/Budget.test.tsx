import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { CategoriesRepo } from '@/domain/categories';
import Budget from '@/pages/Budget';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Transaction } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

describe('Budget page', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    localStorage.clear();
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0008_add_transaction_property_links'),
      mig('0009_seed_categories'),
      mig('0012_add_transaction_person'),
      mig('0013_add_category_budget'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
  });

  afterEach(async () => { await db.close(); });

  it('lists budgetable categories and renders the empty-state when no budgets are set', async () => {
    render(<MemoryRouter><Budget /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
    });
    expect(screen.getByText(/set a monthly budget/i)).toBeInTheDocument();
  });

  it('editing a budget input persists the value via the categories store', async () => {
    render(<MemoryRouter><Budget /></MemoryRouter>);
    const user = userEvent.setup();
    const input = await screen.findByLabelText(/budget for groceries/i);
    await user.clear(input);
    await user.type(input, '600');
    await user.tab(); // blur commits

    await waitFor(async () => {
      const cats = await new CategoriesRepo(db).list();
      const groceries = cats.find((c) => c.name === 'Groceries');
      expect(groceries?.monthlyBudget).toBe(600);
    });
  });

  it('shows the spending summary header with $actual of $budget once a budget is set', async () => {
    // Pre-set a budget on Groceries (id 33) and add an actual transaction
    const repo = new CategoriesRepo(db);
    await repo.update(33, { monthlyBudget: 600 });
    const month = new Date().toISOString().slice(0, 7);
    const txn: Omit<Transaction, 'id'> = {
      householdId: 1, date: `${month}-05`, merchant: 'TJ', merchantRaw: 'TJ',
      amount: 120, categoryId: 33, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: null, reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };
    await useTransactionsStore.getState().createMany([txn]);

    render(<MemoryRouter><Budget /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/^spending$/i)).toBeInTheDocument();
    });
    // Total = $120 of $600 — appears in the Spending header, parent-group
    // subtotal, and the Groceries row caption since it's the only budgeted row.
    expect(screen.getAllByText('$120 of $600').length).toBeGreaterThan(0);
    // The per-row "$X left" badge for under-budget Groceries ($480 remaining)
    expect(screen.getByText('$480 left')).toBeInTheDocument();
  });

  it('reverts a rejected negative budget input without persisting it', async () => {
    render(<MemoryRouter><Budget /></MemoryRouter>);
    const user = userEvent.setup();
    const input = await screen.findByLabelText(/budget for groceries/i);

    // Type a negative value then blur to trigger the commit handler.
    await user.clear(input);
    await user.type(input, '-50');
    await user.tab();

    // (a) The displayed value must be reverted — not left as '-50'.
    // The prior saved budget is null, so the input should revert to empty string.
    expect((input as HTMLInputElement).value).not.toBe('-50');

    // (b) The category's monthlyBudget must NOT have been updated to a negative value.
    const cats = await new CategoriesRepo(db).list();
    const groceries = cats.find((c) => c.name === 'Groceries');
    expect(groceries?.monthlyBudget).toBeNull();
  });

  describe('tracked categories + Misc catch-all', () => {
    const month = new Date().toISOString().slice(0, 7);
    const seedTxn = (categoryId: number, amount: number, day = '05'): Omit<Transaction, 'id'> => ({
      householdId: 1, date: `${month}-${day}`, merchant: 'M', merchantRaw: 'M',
      amount, categoryId, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: null, reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    });

    it('on first load with budgets set on multiple categories, all budgeted rows are tracked (default seed)', async () => {
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 }); // Groceries
      await repo.update(17, { monthlyBudget: 200 }); // Gas/Fuel
      await useTransactionsStore.getState().createMany([
        seedTxn(33, 120),
        seedTxn(17, 80),
      ]);

      render(<MemoryRouter><Budget /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByText('Groceries')).toBeInTheDocument();
        expect(screen.getByText('Gas/Fuel')).toBeInTheDocument();
      });
      // Misc row exists but is zero on the default seed (every budgeted row tracked).
      expect(screen.getByRole('heading', { name: /^misc$/i })).toBeInTheDocument();
    });

    it('untracking a category moves its spending into the Misc aggregation', async () => {
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 }); // Groceries
      await repo.update(17, { monthlyBudget: 200 }); // Gas/Fuel
      await useTransactionsStore.getState().createMany([
        seedTxn(33, 120),
        seedTxn(17, 80),
      ]);

      render(<MemoryRouter><Budget /></MemoryRouter>);
      const user = userEvent.setup();
      await screen.findByText('Gas/Fuel');

      // Click the "Untrack" button on Gas/Fuel.
      const untrackBtn = screen.getByRole('button', { name: /untrack gas\/fuel/i });
      await user.click(untrackBtn);

      // Gas/Fuel row removed from tracked list — only Groceries remains tracked.
      await waitFor(() => {
        expect(screen.queryByLabelText(/budget for gas\/fuel/i)).not.toBeInTheDocument();
      });
      // Misc now carries the $80 actual / $200 budget; both the Misc section
      // header and the BudgetOverlayRow caption render this string.
      const miscCaptions = await screen.findAllByText('$80 of $200');
      expect(miscCaptions.length).toBeGreaterThan(0);
    });

    it('with tracked = [] all spending shows in the Misc aggregation row', async () => {
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 });
      await repo.update(17, { monthlyBudget: 200 });
      await useTransactionsStore.getState().createMany([
        seedTxn(33, 120),
        seedTxn(17, 80),
      ]);
      // Pre-seed an empty tracked selection.
      localStorage.setItem('trackedBudgetCategories.v1', JSON.stringify([]));

      render(<MemoryRouter><Budget /></MemoryRouter>);
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /^misc$/i })).toBeInTheDocument();
      });
      // No tracked rows present — confirm Groceries input is not rendered.
      expect(screen.queryByLabelText(/budget for groceries/i)).not.toBeInTheDocument();
      // Misc row shows totals: $200 actual of $800 budget. Both the section
      // header and the overlay caption render this string.
      const totals = screen.getAllByText('$200 of $800');
      expect(totals.length).toBeGreaterThan(0);
    });

    it('the "Add category" picker re-adds an untracked category to the tracked list', async () => {
      const repo = new CategoriesRepo(db);
      await repo.update(33, { monthlyBudget: 600 });
      await repo.update(17, { monthlyBudget: 200 });
      await useTransactionsStore.getState().createMany([seedTxn(17, 80)]);
      localStorage.setItem('trackedBudgetCategories.v1', JSON.stringify([33]));

      render(<MemoryRouter><Budget /></MemoryRouter>);
      const user = userEvent.setup();
      await screen.findByText('Groceries');

      // Gas/Fuel is not tracked — its input should not exist.
      expect(screen.queryByLabelText(/budget for gas\/fuel/i)).not.toBeInTheDocument();

      // Pick Gas/Fuel from the "Add category" select.
      const picker = screen.getByLabelText(/add category/i);
      await user.selectOptions(picker, '17');

      // Gas/Fuel input now renders.
      await waitFor(() => {
        expect(screen.getByLabelText(/budget for gas\/fuel/i)).toBeInTheDocument();
      });
    });
  });
});
