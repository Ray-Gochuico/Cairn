import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// pdfjs-dist uses DOMMatrix which is not available in jsdom. Mock the
// extract module so the component can be imported without pulling in pdfjs.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));

// parseStatement uses the extract output — mock it to return a minimal result.
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({
    issuer: 'GENERIC',
    transactions: [
      {
        date: '2026-03-01',
        merchantRaw: 'MOCK MERCHANT',
        merchant: 'MOCK MERCHANT',
        amount: 10.0,
      },
    ],
  }),
}));

// archiveStatementPdf touches the Tauri fs plugin — mock so the component can
// run in jsdom without resolving the real implementation.
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSettingsStore } from '@/stores/settings-store';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType } from '@/types/enums';
import TransactionsSectionImporter from '@/components/setup/TransactionsSectionImporter';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(
    resolve(__dirname, `../../../src/db/migrations/${file}.sql`),
    'utf-8',
  ),
});

function renderImporter() {
  return render(
    <MemoryRouter>
      <TransactionsSectionImporter />
    </MemoryRouter>,
  );
}

describe('TransactionsSectionImporter', () => {
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
    useCategoriesStore.setState({
      categories: [],
      isLoading: false,
      error: null,
    });
    useTransactionsStore.setState({
      transactions: [],
      isLoading: false,
      error: null,
    });
    usePersonsStore.setState({
      persons: [],
      isLoading: false,
      error: null,
    });
    useAccountsStore.setState({
      accounts: [],
      isLoading: false,
      error: null,
    });
    useSettingsStore.setState({
      settings: null,
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders a drop zone with "Drop PDFs or CSVs here" copy', () => {
    renderImporter();
    expect(screen.getByText(/Drop PDFs or CSVs here/i)).toBeInTheDocument();
  });

  it('exposes a hidden file input labelled for transactions PDF or CSV', () => {
    renderImporter();
    expect(
      screen.getByLabelText(/transactions pdf or csv/i),
    ).toBeInTheDocument();
  });

  it('routes a dropped PDF through the PDF review modal', async () => {
    await useCategoriesStore.getState().load();
    renderImporter();

    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'mar.pdf', {
      type: 'application/pdf',
    });
    const dropHandle = screen
      .getByText(/Drop PDFs or CSVs here/i)
      .closest('div')!;
    const dataTransfer = { files: [pdf], types: ['Files'] };
    fireEvent.dragOver(dropHandle, { dataTransfer });
    fireEvent.drop(dropHandle, { dataTransfer });

    // PDF review modal opens.
    await screen.findByText(/review transactions/i);
    expect(screen.queryByText(/import transactions from csv/i)).toBeNull();
  });

  it('routes a dropped CSV through the CSV preview modal', async () => {
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
    useAccountsStore.setState({
      accounts: [
        {
          id: accountId,
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
        },
      ],
      isLoading: false,
      error: null,
    });

    renderImporter();

    const csv = new File(
      [
        'date,account,amount,merchant,category,reimbursable\n2024-03-15,Chase Checking,20.00,STARBUCKS,,no\n',
      ],
      'txns.csv',
      { type: 'text/csv' },
    );
    const input = screen.getByLabelText(
      /transactions pdf or csv/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [csv],
      configurable: true,
    });
    fireEvent.change(input);

    await screen.findByRole('dialog');
    expect(screen.getByText(/import transactions from csv/i)).toBeInTheDocument();
    expect(screen.queryByText(/review transactions/i)).toBeNull();
  });

  it('skipping the first of two queued CSVs advances to the second, not drop the batch (wave-9 S80)', async () => {
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
    useAccountsStore.setState({
      accounts: [
        {
          id: accountId,
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
        },
      ],
      isLoading: false,
      error: null,
    });

    renderImporter();

    const fileOne = new File(
      ['date,account,amount,merchant,category,reimbursable\n2024-03-15,Chase Checking,20.00,STARBUCKS,,no\n'],
      'one.csv',
      { type: 'text/csv' },
    );
    const fileTwo = new File(
      ['date,account,amount,merchant,category,reimbursable\n2024-03-16,Chase Checking,30.00,WHOLEFOODS,,no\n'],
      'two.csv',
      { type: 'text/csv' },
    );
    const input = screen.getByLabelText(/transactions pdf or csv/i) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [fileOne, fileTwo], configurable: true });
    fireEvent.change(input);

    // File 1 of 2 is previewing, with an explicit batch-cancel affordance.
    await screen.findByRole('dialog');
    expect(await screen.findByText('STARBUCKS')).toBeInTheDocument();
    expect(screen.getByText(/File 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel all 2 files/i })).toBeInTheDocument();

    // Skip just this file → the SECOND file's preview appears (batch survives).
    fireEvent.click(screen.getByRole('button', { name: /skip this file/i }));
    expect(await screen.findByText('WHOLEFOODS')).toBeInTheDocument();
    expect(screen.getByText(/File 2 of 2/i)).toBeInTheDocument();
  });

  it('silently skips an unsupported .txt file dropped onto the zone', async () => {
    await useCategoriesStore.getState().load();
    renderImporter();

    const dropHandle = screen
      .getByText(/Drop PDFs or CSVs here/i)
      .closest('div')!;
    const txt = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(dropHandle, {
      dataTransfer: { files: [txt], types: ['Files'] },
    });

    // No modal opens.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/review transactions/i)).toBeNull();
  });

  it('surfaces a per-file error pane when a CSV read fails', async () => {
    await useCategoriesStore.getState().load();
    renderImporter();

    const bad = new File(['x'], 'bad.csv', { type: 'text/csv' });
    Object.defineProperty(bad, 'text', {
      value: () => Promise.reject(new Error('read failed')),
      configurable: true,
    });
    const input = screen.getByLabelText(
      /transactions pdf or csv/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [bad],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getByText(/bad\.csv/)).toBeInTheDocument();
    });
  });
});
