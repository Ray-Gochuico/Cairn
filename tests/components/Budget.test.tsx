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

  it('shows the budget-vs-actual chart once a budget is set', async () => {
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
      expect(screen.getByText(/budget vs actual/i)).toBeInTheDocument();
    });
  });
});
