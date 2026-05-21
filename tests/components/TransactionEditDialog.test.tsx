import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionEditDialog } from '@/components/dialogs/TransactionEditDialog';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { setDatabase } from '@/db/db';
import { runMigrations } from '@/db/migrations';
import { useTransactionsStore } from '@/stores/transactions-store';
import { TransactionsRepo } from '@/domain/transactions';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Transaction, Category } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

const categories: Category[] = [
  { id: 32, name: 'Food & Drink', parentCategoryId: null, color: null, icon: null,
    type: 'WANT', isCapital: false, systemManaged: false },
  { id: 33, name: 'Groceries', parentCategoryId: null, color: null, icon: null,
    type: 'NEED', isCapital: false, systemManaged: false },
];

const baseTransaction: Omit<Transaction, 'id'> = {
  householdId: 1, date: '2026-03-05', merchant: 'STARBUCKS', merchantRaw: 'STARBUCKS #1',
  amount: 7.5, categoryId: 32, sourceAccountId: null, propertyId: null, vehicleId: null,
  sourcePdfFilename: 'mar.pdf', reimbursable: false, reimbursedAt: null,
  reimbursedAmount: null, isRecurring: false, notes: null,
};

describe('TransactionEditDialog', () => {
  let db: SqliteAdapter;
  let transaction: Transaction;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [mig('0001_initial'), mig('0008_add_transaction_property_links'), mig('0009_seed_categories')]);
    setDatabase(db);
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
    const repo = new TransactionsRepo(db);
    const id = await repo.create(baseTransaction);
    transaction = { ...baseTransaction, id };
  });

  afterEach(async () => { await db.close(); });

  it('prefills the merchant, amount, and category from the transaction', () => {
    render(
      <TransactionEditDialog transaction={transaction} categories={categories}
        onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByLabelText('Merchant')).toHaveValue('STARBUCKS');
    expect(screen.getByLabelText('Amount')).toHaveValue(7.5);
    expect(screen.getByLabelText('Category')).toHaveValue('32');
  });

  it('saving an edited merchant and amount writes them to the database', async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <TransactionEditDialog transaction={transaction} categories={categories}
        onClose={vi.fn()} onSaved={onSaved} />,
    );
    const merchant = screen.getByLabelText('Merchant');
    await user.clear(merchant);
    await user.type(merchant, 'PEETS COFFEE');
    const amount = screen.getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '9.25');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const rows = await new TransactionsRepo(db).list();
    expect(rows[0].merchant).toBe('PEETS COFFEE');
    expect(rows[0].amount).toBe(9.25);
    expect(onSaved).toHaveBeenCalled();
  });

  it('deleting requires confirmation, then removes the transaction', async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <TransactionEditDialog transaction={transaction} categories={categories}
        onClose={vi.fn()} onSaved={onSaved} />,
    );
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    // confirmation appears; the row is still there until confirmed
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    const rows = await new TransactionsRepo(db).list();
    expect(rows).toHaveLength(0);
    expect(onSaved).toHaveBeenCalled();
  });
});
