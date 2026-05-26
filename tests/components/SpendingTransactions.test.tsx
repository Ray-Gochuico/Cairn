import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import { AccountsRepo } from '@/domain/accounts';
import { AccountType } from '@/types/enums';
import SpendingTransactions from '@/pages/SpendingTransactions';
import type { Transaction } from '@/types/schema';

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
  categoryId: 37, // Shopping
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

describe('SpendingTransactions page', () => {
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

  it('renders the full transactions list with header and back link', async () => {
    await useCategoriesStore.getState().load();
    await useTransactionsStore.getState().createMany([
      mkTxn({ merchant: 'AMAZON', date: '2026-03-05' }),
      mkTxn({ merchant: 'STARBUCKS', date: '2026-03-06' }),
      mkTxn({ merchant: 'NETFLIX', date: '2026-03-07' }),
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /all transactions/i })).toBeInTheDocument();
      expect(screen.getByText('AMAZON')).toBeInTheDocument();
      expect(screen.getByText('STARBUCKS')).toBeInTheDocument();
      expect(screen.getByText('NETFLIX')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: /back to spending/i })).toHaveAttribute(
      'href',
      '/spending',
    );
    expect(screen.getByText(/3 transactions/i)).toBeInTheDocument();
  });

  it('shows empty state when there are no transactions', async () => {
    await useCategoriesStore.getState().load();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
    });
  });

  it('inline-edits a transaction category and persists via the transactions store', async () => {
    await useCategoriesStore.getState().load();
    const repo = new TransactionsRepo(db);
    const [txnId] = await repo.createMany([
      mkTxn({ merchant: 'AMAZON', categoryId: 37 /* Shopping */ }),
    ]);
    await useTransactionsStore.getState().load();
    renderPage();

    const user = userEvent.setup();
    await screen.findByText('AMAZON');

    await user.click(screen.getByRole('button', { name: /edit amazon/i }));

    const categorySelect = await screen.findByLabelText(/edit category for amazon/i);
    // Pick a different category (Food & Drink = id 32 per the seed migration)
    await user.selectOptions(categorySelect, '32');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(async () => {
      const reloaded = await repo.list();
      const updated = reloaded.find((t) => t.id === txnId);
      expect(updated?.categoryId).toBe(32);
    });
  });

  it('inline-edits a transaction account and persists via the transactions store', async () => {
    await useCategoriesStore.getState().load();

    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Chase Checking',
      institution: null,
      type: AccountType.ACCOUNT_CASH,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
    await useAccountsStore.getState().load();

    const repo = new TransactionsRepo(db);
    const [txnId] = await repo.createMany([mkTxn({ merchant: 'AMAZON', sourceAccountId: null })]);
    await useTransactionsStore.getState().load();
    renderPage();

    const user = userEvent.setup();
    await screen.findByText('AMAZON');

    await user.click(screen.getByRole('button', { name: /edit amazon/i }));

    const accountSelect = await screen.findByLabelText(/edit account for amazon/i);
    await user.selectOptions(accountSelect, String(accountId));

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(async () => {
      const reloaded = await repo.list();
      const updated = reloaded.find((t) => t.id === txnId);
      expect(updated?.sourceAccountId).toBe(accountId);
    });
  });

  it('cancels inline edit without persisting changes', async () => {
    await useCategoriesStore.getState().load();
    const repo = new TransactionsRepo(db);
    await repo.createMany([mkTxn({ merchant: 'AMAZON', categoryId: 37 })]);
    await useTransactionsStore.getState().load();
    renderPage();

    const user = userEvent.setup();
    await screen.findByText('AMAZON');

    await user.click(screen.getByRole('button', { name: /edit amazon/i }));
    const merchantInput = await screen.findByLabelText(/edit merchant for amazon/i);
    await user.clear(merchantInput);
    await user.type(merchantInput, 'NEW NAME');
    await user.click(screen.getByRole('button', { name: /cancel edit/i }));

    // Original merchant name still shown, edit panel closed
    expect(screen.getByText('AMAZON')).toBeInTheDocument();
    expect(screen.queryByLabelText(/edit merchant for amazon/i)).not.toBeInTheDocument();

    // DB unchanged
    const reloaded = await repo.list();
    expect(reloaded[0].merchant).toBe('AMAZON');
  });

  it('deletes a transaction after confirmation, removing it from the list', async () => {
    await useCategoriesStore.getState().load();
    const repo = new TransactionsRepo(db);
    await repo.createMany([
      mkTxn({ merchant: 'AMAZON', date: '2026-03-05' }),
      mkTxn({ merchant: 'STARBUCKS', date: '2026-03-06' }),
    ]);
    await useTransactionsStore.getState().load();
    renderPage();

    const user = userEvent.setup();
    await screen.findByText('AMAZON');

    await user.click(screen.getByRole('button', { name: /delete amazon/i }));

    // Confirm prompt appears
    expect(screen.getByText(/delete\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm delete amazon/i }));

    await waitFor(() => {
      expect(screen.queryByText('AMAZON')).not.toBeInTheDocument();
    });
    // Other transaction still there
    expect(screen.getByText('STARBUCKS')).toBeInTheDocument();

    const reloaded = await repo.list();
    expect(reloaded.find((t) => t.merchant === 'AMAZON')).toBeUndefined();
  });

  it('cancels delete confirmation without removing the transaction', async () => {
    await useCategoriesStore.getState().load();
    const repo = new TransactionsRepo(db);
    await repo.createMany([mkTxn({ merchant: 'AMAZON' })]);
    await useTransactionsStore.getState().load();
    renderPage();

    const user = userEvent.setup();
    await screen.findByText('AMAZON');

    await user.click(screen.getByRole('button', { name: /delete amazon/i }));
    expect(screen.getByText(/delete\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel delete/i }));

    // Confirmation gone, row still present
    expect(screen.queryByText(/delete\?/i)).not.toBeInTheDocument();
    expect(screen.getByText('AMAZON')).toBeInTheDocument();

    const reloaded = await repo.list();
    expect(reloaded.find((t) => t.merchant === 'AMAZON')).toBeDefined();
  });

  it('shows a validation error for empty merchant on save', async () => {
    await useCategoriesStore.getState().load();
    const repo = new TransactionsRepo(db);
    await repo.createMany([mkTxn({ merchant: 'AMAZON' })]);
    await useTransactionsStore.getState().load();
    renderPage();

    const user = userEvent.setup();
    await screen.findByText('AMAZON');

    await user.click(screen.getByRole('button', { name: /edit amazon/i }));
    const merchantInput = await screen.findByLabelText(/edit merchant for amazon/i);
    await user.clear(merchantInput);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/merchant cannot be empty/i)).toBeInTheDocument();
    const reloaded = await repo.list();
    expect(reloaded[0].merchant).toBe('AMAZON');
  });

  it('sorts rows by date descending (most recent first)', async () => {
    await useCategoriesStore.getState().load();
    await useTransactionsStore.getState().createMany([
      mkTxn({ merchant: 'OLD',    date: '2026-01-01' }),
      mkTxn({ merchant: 'NEWEST', date: '2026-04-01' }),
      mkTxn({ merchant: 'MIDDLE', date: '2026-02-15' }),
    ]);
    renderPage();

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    // rows[0] is the thead row; data rows follow
    const cellsByRow = rows.slice(1).map((r) =>
      within(r).getAllByRole('cell').map((c) => c.textContent),
    );
    expect(cellsByRow[0][1]).toBe('NEWEST');
    expect(cellsByRow[1][1]).toBe('MIDDLE');
    expect(cellsByRow[2][1]).toBe('OLD');
  });
});
