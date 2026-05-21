import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkReimbursedDialog } from '@/components/dialogs/MarkReimbursedDialog';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { setDatabase } from '@/db/db';
import { runMigrations } from '@/db/migrations';
import { useTransactionsStore } from '@/stores/transactions-store';
import { TransactionsRepo } from '@/domain/transactions';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Transaction } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

const baseTransaction: Transaction = {
  id: undefined, // will be set after insert
  householdId: 1,
  date: '2026-03-05',
  merchant: 'ACME CORP',
  merchantRaw: 'ACME CORP #1',
  amount: 75.50,
  categoryId: null,
  sourceAccountId: null,
  propertyId: null,
  vehicleId: null,
  personId: null,
  sourcePdfFilename: 'mar.pdf',
  reimbursable: true,
  reimbursedAt: null,
  reimbursedAmount: null,
  isRecurring: false,
  notes: null,
};

describe('MarkReimbursedDialog', () => {
  let db: SqliteAdapter;
  let transaction: Transaction;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0008_add_transaction_property_links'),
      mig('0012_add_transaction_person'),
    ]);
    setDatabase(db);
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });

    // Insert a transaction and get its id back
    const repo = new TransactionsRepo(db);
    const id = await repo.create({ ...baseTransaction, id: undefined } as Omit<Transaction, 'id'>);
    transaction = { ...baseTransaction, id };
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders with the transaction amount prefilled', () => {
    render(
      <MarkReimbursedDialog
        transaction={transaction}
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
      />,
    );

    const amountInput = screen.getByRole('spinbutton', { name: /reimbursed amount/i });
    expect(amountInput).toHaveValue(75.5);
  });

  it('confirming writes reimbursedAt and reimbursedAmount to the transaction', async () => {
    const onConfirmed = vi.fn();
    const user = userEvent.setup();

    render(
      <MarkReimbursedDialog
        transaction={transaction}
        onClose={vi.fn()}
        onConfirmed={onConfirmed}
      />,
    );

    // The amount is prefilled; leave it as-is
    // Pick a date using the DatePicker selects (Year / Month / Day)
    const yearSelect = screen.getByRole('combobox', { name: /year/i });
    const monthSelect = screen.getByRole('combobox', { name: /month/i });
    const daySelect = screen.getByRole('combobox', { name: /day/i });

    await user.selectOptions(yearSelect, '2026');
    await user.selectOptions(monthSelect, '03'); // Mar
    await user.selectOptions(daySelect, '20');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // Verify the DB row was updated
    const repo = new TransactionsRepo(db);
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].reimbursedAt).toBe('2026-03-20');
    expect(rows[0].reimbursedAmount).toBe(75.5);

    expect(onConfirmed).toHaveBeenCalled();
  });
});
