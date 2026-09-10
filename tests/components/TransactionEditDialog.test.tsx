import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionEditDialog, reimbursementStatusLine } from '@/components/dialogs/TransactionEditDialog';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { setDatabase } from '@/db/db';
import { runMigrations } from '@/db/migrations';
import { useTransactionsStore } from '@/stores/transactions-store';
import { TransactionsRepo } from '@/domain/transactions';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Transaction, Category, Property, Vehicle } from '@/types/schema';

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
  personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false, reimbursedAt: null,
  reimbursedAmount: null, isRecurring: false, notes: null,
};

describe('TransactionEditDialog', () => {
  let db: SqliteAdapter;
  let transaction: Transaction;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [mig('0001_initial'), mig('0008_add_transaction_property_links'), mig('0012_add_transaction_person'), mig('0009_seed_categories')]);
    setDatabase(db);
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
    // Seed two persons so person FK constraints are satisfied in the person picker tests.
    await db.execute(
      `INSERT INTO persons (id, household_id, name, date_of_birth, target_retirement_age)
       VALUES (1, 1, 'Alex', '1990-01-01', 65), (2, 1, 'Sam', '1992-01-01', 65)`,
    );
    const repo = new TransactionsRepo(db);
    const id = await repo.create(baseTransaction);
    transaction = { ...baseTransaction, id };
  });

  afterEach(async () => { await db.close(); });

  it('prefills the merchant, amount, and category from the transaction', () => {
    render(
      <TransactionEditDialog transaction={transaction} categories={categories}
        properties={[]} vehicles={[]} persons={[]} onClose={vi.fn()} onSaved={vi.fn()} />,
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
        properties={[]} vehicles={[]} persons={[]} onClose={vi.fn()} onSaved={onSaved} />,
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
        properties={[]} vehicles={[]} persons={[]} onClose={vi.fn()} onSaved={onSaved} />,
    );
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    // confirmation appears; the row is still there until confirmed
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    const rows = await new TransactionsRepo(db).list();
    expect(rows).toHaveLength(0);
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows a property picker when the category is a Home child, and saves the pick', async () => {
    const user = userEvent.setup();
    // Home parent + a Home child category
    const homeCats: Category[] = [
      { id: 1, name: 'Home', parentCategoryId: null, color: null, icon: null,
        type: 'NEED', isCapital: false, systemManaged: false },
      { id: 7, name: 'Maintenance', parentCategoryId: 1, color: null, icon: null,
        type: 'NEED', isCapital: false, systemManaged: false },
    ];
    // Seed a real property into the DB so the FK constraint on transactions.property_id is satisfied.
    await db.execute(
      `INSERT INTO properties (id, household_id, name, type, excluded_from_net_worth)
       VALUES (5, 1, 'Main House', 'PRIMARY_RESIDENCE', 0)`,
    );
    const properties = [{ id: 5, name: 'Main House' }] as Property[];
    render(
      <TransactionEditDialog transaction={transaction} categories={homeCats}
        properties={properties} vehicles={[]} persons={[]} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    // pick the Home child category → property picker appears
    await user.selectOptions(screen.getByLabelText('Category'), '7');
    const propertyPicker = screen.getByLabelText('Property');
    await user.selectOptions(propertyPicker, '5');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const rows = await new TransactionsRepo(db).list();
    expect(rows[0].propertyId).toBe(5);
    expect(rows[0].categoryId).toBe(7);
  });

  it('shows a person picker for a two-person household and saves the pick', async () => {
    const user = userEvent.setup();
    const persons = [{ id: 1, name: 'Alex' }, { id: 2, name: 'Sam' }];
    render(
      <TransactionEditDialog transaction={transaction} categories={categories}
        properties={[]} vehicles={[]} persons={persons}
        onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    await user.selectOptions(screen.getByLabelText('Person'), '2');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    const rows = await new TransactionsRepo(db).list();
    expect(rows[0].personId).toBe(2);
  });

  it('hides the person picker for a one-person household', () => {
    render(
      <TransactionEditDialog transaction={transaction} categories={categories}
        properties={[]} vehicles={[]} persons={[{ id: 1, name: 'Alex' }]}
        onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
  });

  describe('R2 — reimbursement state in the editor (chip task_32707759)', () => {
    const settled: Transaction = {
      ...baseTransaction, id: 901, merchant: 'Skyline Bistro', amount: 132.4,
      reimbursable: true, reimbursedAt: '2026-06-25', reimbursedAmount: 132.4,
    };
    const renderDialog = (t: Transaction) =>
      render(
        <TransactionEditDialog transaction={t} categories={categories}
          properties={[]} vehicles={[]} persons={[]} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

    it('a settled reimbursement states its amount and date (CR-R2-1) — the only place it showed before was its absence from the Awaiting list', () => {
      renderDialog(settled);
      expect(screen.getByLabelText('Reimbursable')).toBeChecked();
      expect(screen.getByTestId('edit-reimbursement-status')).toHaveTextContent('Reimbursed $132.40 on Jun 25, 2026.');
    });

    it('a pending reimbursable states that it is awaiting (CR-R2-2)', () => {
      renderDialog({ ...settled, id: 902, merchant: 'Harbor Cab Co', amount: 46, reimbursedAt: null, reimbursedAmount: null });
      expect(screen.getByTestId('edit-reimbursement-status')).toHaveTextContent('Awaiting reimbursement.');
    });

    it('a non-reimbursable row renders no status line at all', () => {
      renderDialog(transaction);
      expect(screen.queryByTestId('edit-reimbursement-status')).toBeNull();
    });

    it('the checkbox is DESCRIBED by the status line (review MINOR 0) — tabbing to it announces the state, not just "Reimbursable, checked"', () => {
      // The house trio (HouseholdForm's aria-invalid + aria-describedby +
      // FieldError): visual adjacency alone leaves the line unreachable for
      // anyone who does not read the dialog linearly.
      renderDialog(settled);
      expect(screen.getByLabelText('Reimbursable')).toHaveAccessibleDescription(
        'Reimbursed $132.40 on Jun 25, 2026.',
      );
    });

    it('a row with no status line leaves the checkbox undescribed — no dangling aria-describedby', () => {
      renderDialog(transaction);
      const checkbox = screen.getByLabelText('Reimbursable');
      expect(checkbox).not.toHaveAttribute('aria-describedby');
      expect(checkbox).not.toHaveAccessibleDescription();
    });

    it('a partial reimbursement states the REIMBURSED amount, never the charge', () => {
      renderDialog({ ...settled, id: 903, reimbursedAmount: 100 });
      expect(screen.getByTestId('edit-reimbursement-status')).toHaveTextContent('Reimbursed $100.00 on Jun 25, 2026.');
    });

    it('the line reads the SAVED row — unchecking Reimbursable in the dialog does not erase a recorded reimbursement (D-R2-9)', async () => {
      const user = userEvent.setup();
      renderDialog(settled);
      await user.click(screen.getByLabelText('Reimbursable'));
      expect(screen.getByLabelText('Reimbursable')).not.toBeChecked();
      expect(screen.getByTestId('edit-reimbursement-status')).toHaveTextContent('Reimbursed $132.40 on Jun 25, 2026.');
    });

    it('reimbursementStatusLine: the three forms and the null form', () => {
      expect(reimbursementStatusLine({ reimbursable: false, reimbursedAt: '2026-06-25', reimbursedAmount: 5 })).toBeNull();
      expect(reimbursementStatusLine({ reimbursable: true, reimbursedAt: null, reimbursedAmount: null })).toBe('Awaiting reimbursement.');
      expect(reimbursementStatusLine({ reimbursable: true, reimbursedAt: '2026-06-25', reimbursedAmount: null })).toBe('Reimbursed on Jun 25, 2026.');
      expect(reimbursementStatusLine({ reimbursable: true, reimbursedAt: '2026-06-25', reimbursedAmount: 1234.5 })).toBe('Reimbursed $1,234.50 on Jun 25, 2026.');
    });
  });
});
