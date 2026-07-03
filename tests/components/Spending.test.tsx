import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

// pdfjs-dist uses DOMMatrix which is not available in jsdom. Mock the extract
// module so the Spending page can be imported without pulling in pdfjs.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));

// parseStatement uses the extract output — mock it to return a minimal result.
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({
    issuer: 'GENERIC',
    transactions: [
      { date: '2026-03-01', merchantRaw: 'MOCK MERCHANT', merchant: 'MOCK MERCHANT', amount: 10.00 },
    ],
  }),
}));

// archiveStatementPdf touches the Tauri fs plugin, which is unavailable in
// jsdom. Mock the whole module; the no-folder path never calls it anyway.
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { useHouseholdStore } from '@/stores/household-store';
import { TransactionsRepo } from '@/domain/transactions';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType } from '@/types/enums';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { HousingPaymentsRepo } from '@/domain/housing-payments';
import { VehicleLeasesRepo } from '@/domain/vehicle-leases';
import Spending from '@/pages/Spending';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PersonsRepo } from '@/domain/persons';
import type { Transaction, Person } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Spending />
    </MemoryRouter>,
  );
}

describe('Spending page', () => {
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
      mig('0036_add_rent_lease_tracking'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    useHousingPaymentsStore.setState({
      housingPayments: [],
      isLoading: false,
      error: null,
    });
    useVehicleLeasesStore.setState({
      vehicleLeases: [],
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('(a) renders the unified drop zone and an empty-state message when there are no transactions', async () => {
    renderPage();

    // Drop zone is visible (unified statements + CSVs)
    expect(
      screen.getByText(/drop pdfs or csvs here/i),
    ).toBeInTheDocument();

    // File input for drag-and-drop should be present
    expect(
      screen.getByLabelText(/transactions pdf or csv/i),
    ).toBeInTheDocument();

    // Empty state message
    await waitFor(() => {
      expect(
        screen.getByText(/no transactions yet/i),
      ).toBeInTheDocument();
    });
  });

  it('(a2) does not render the legacy standalone "Import CSV" button in the header', () => {
    renderPage();
    // The unified drop zone is present.
    expect(
      screen.getByText(/drop pdfs or csvs here/i),
    ).toBeInTheDocument();
    // The old standalone "Import CSV" button is gone.
    expect(screen.queryByRole('button', { name: /^import csv$/i })).toBeNull();
  });

  it('(b) with seeded transactions in the store, the list renders them with category names', async () => {
    // Pre-seed: insert categories and transactions directly via the store
    await useCategoriesStore.getState().load();

    // Insert two transactions directly in the DB
    const txn1: Omit<Transaction, 'id'> = {
      householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
      amount: 54.23, categoryId: 37 /* Shopping */, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };
    const txn2: Omit<Transaction, 'id'> = {
      householdId: 1, date: '2026-03-06', merchant: 'STARBUCKS', merchantRaw: 'STARBUCKS #1',
      amount: 7.50, categoryId: 32 /* Food & Drink */, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };

    await useTransactionsStore.getState().createMany([txn1, txn2]);

    renderPage();

    // Both merchant names should appear (may appear in both top-merchants and transactions list)
    await waitFor(() => {
      expect(screen.getAllByText('AMAZON').length).toBeGreaterThan(0);
      expect(screen.getAllByText('STARBUCKS').length).toBeGreaterThan(0);
    });

    // Category names should appear
    await waitFor(() => {
      expect(screen.getByText('Shopping')).toBeInTheDocument();
      expect(screen.getByText('Food & Drink')).toBeInTheDocument();
    });
  });

  it('(hero) renders the glance hero with range tabs on a seeded-transactions page', async () => {
    await useCategoriesStore.getState().load();
    await useTransactionsStore.getState().createMany([
      {
        householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: null,
        amount: 54.23, categoryId: 37, sourceAccountId: null, propertyId: null,
        vehicleId: null, personId: null, sourcePdfFilename: null, reimbursable: false,
        reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
      },
    ]);
    renderPage();
    const hero = await screen.findByTestId('spending-hero');
    expect(within(hero).getByRole('tablist')).toBeInTheDocument();
    expect(within(hero).getByRole('tab', { name: 'This month' })).toHaveAttribute('aria-selected', 'true');
  });

  it('(c) shows top merchants, subscription count, and awaiting-reimbursement row', async () => {
    await useCategoriesStore.getState().load();

    // A recurring trio (NETFLIX, ~monthly, same amount)
    const netflixBase: Omit<Transaction, 'id'> = {
      householdId: 1, merchant: 'NETFLIX', merchantRaw: 'NETFLIX.COM',
      amount: 15.49, categoryId: 37, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
      date: '2026-01-09',
    };
    // One pending reimbursable transaction
    const reimbursableTxn: Omit<Transaction, 'id'> = {
      householdId: 1, date: '2026-03-10', merchant: 'ACME EXPENSE', merchantRaw: 'ACME EXPENSE',
      amount: 200, categoryId: 37, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: true,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };

    await useTransactionsStore.getState().createMany([
      { ...netflixBase, date: '2026-01-09' },
      { ...netflixBase, date: '2026-02-09' },
      { ...netflixBase, date: '2026-03-09' },
      reimbursableTxn,
    ]);

    renderPage();

    // Top merchants section renders (as a BarChartCard — merchant names appear in Recharts SVG
    // which jsdom may not expose as queryable text, so we assert the section heading instead).
    // NETFLIX appears reliably as DOM text in the recent-transactions list.
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /top merchants/i })).toBeInTheDocument();
      expect(screen.getAllByText('NETFLIX').length).toBeGreaterThan(0);
    });

    // Subscriptions section shows 1 service
    await waitFor(() => {
      expect(
        screen.getByText(/1 service/i),
      ).toBeInTheDocument();
    });

    // Awaiting reimbursement section shows the reimbursable transaction
    await waitFor(() => {
      expect(screen.getAllByText('ACME EXPENSE').length).toBeGreaterThan(0);
      expect(
        screen.getByRole('button', { name: /mark reimbursed/i }),
      ).toBeInTheDocument();
    });
  });

  it('(open-all) shows an "Open all transactions" link to the sub-route when transactions exist', async () => {
    await useCategoriesStore.getState().load();
    const txn: Omit<Transaction, 'id'> = {
      householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
      amount: 54.23, categoryId: 37, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };
    await useTransactionsStore.getState().createMany([txn]);
    renderPage();

    const link = await screen.findByRole('link', { name: /open all transactions/i });
    expect(link).toHaveAttribute('href', '/spending/transactions');
  });

  it('(e) clicking a transaction row Edit button opens the edit dialog', async () => {
    await useCategoriesStore.getState().load();
    const txn: Omit<Transaction, 'id'> = {
      householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
      amount: 54.23, categoryId: 37, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };
    await useTransactionsStore.getState().createMany([txn]);
    renderPage();

    const user = userEvent.setup();
    const editButton = await screen.findByRole('button', { name: /edit amazon/i });
    await user.click(editButton);

    expect(await screen.findByText('Edit transaction')).toBeInTheDocument();
    expect(screen.getByLabelText('Merchant')).toHaveValue('AMAZON');
  });

  it('(f) honors the ?view=p1 filter — shows only that person\'s transactions', async () => {
    await useCategoriesStore.getState().load();

    // Persons must be inserted in the DB — the page's mount effect calls
    // loadPersons(), which would overwrite a usePersonsStore.setState seed.
    const mkPerson = (name: string): Omit<Person, 'id'> => ({
      householdId: 1, name, dateOfBirth: '1990-01-01', targetRetirementAge: 65,
      annualSalaryPretax: 0, expectedBonus: 0, expectedBonusFrequency: 'ANNUAL',
      bonusIsConsistent: true, expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY', employmentType: 'SALARY_NO_OT',
      hourlyRate: null, regularHoursPerWeek: 40, otThresholdHoursPerWeek: null,
      pretax401kPct: 0, healthInsuranceMonthlyPremium: 0, dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0, hsaEligible: false,
    });
    const personsRepo = new PersonsRepo(db);
    await personsRepo.create(mkPerson('Alex')); // id 1
    await personsRepo.create(mkPerson('Sam'));  // id 2

    const mk = (over: Partial<Omit<Transaction, 'id'>>): Omit<Transaction, 'id'> => ({
      householdId: 1, date: '2026-03-05', merchant: 'X', merchantRaw: 'X', amount: 10,
      categoryId: 37, sourceAccountId: null, propertyId: null, vehicleId: null,
      personId: null, sourcePdfFilename: 'm.pdf', reimbursable: false, reimbursedAt: null,
      reimbursedAmount: null, isRecurring: false, notes: null, ...over,
    });
    await useTransactionsStore.getState().createMany([
      mk({ merchant: 'ALEXMART', personId: 1 }),
      mk({ merchant: 'SAMSHOP', personId: 2 }),
    ]);

    render(
      <MemoryRouter initialEntries={['/spending?view=p1']}>
        <Spending />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('ALEXMART').length).toBeGreaterThan(0);
      expect(screen.queryByText('SAMSHOP')).not.toBeInTheDocument();
    });
  });

  it('(g) Export CSV downloads the transactions table with FK names resolved', async () => {
    await useCategoriesStore.getState().load();

    // FK targets: one account (id 1) and one person (id 1) in the DB.
    const personsRepo = new PersonsRepo(db);
    await personsRepo.create({
      householdId: 1, name: 'Alex', dateOfBirth: '1990-01-01', targetRetirementAge: 65,
      annualSalaryPretax: 0, expectedBonus: 0, expectedBonusFrequency: 'ANNUAL',
      bonusIsConsistent: true, expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY', employmentType: 'SALARY_NO_OT',
      hourlyRate: null, regularHoursPerWeek: 40, otThresholdHoursPerWeek: null,
      pretax401kPct: 0, healthInsuranceMonthlyPremium: 0, dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0, hsaEligible: false,
    });
    await db.execute(
      `INSERT INTO accounts
        (id, household_id, owner_person_id, beneficiary_dependent_id, name,
         institution, type, crypto_wallet_address, auto_fetch_enabled,
         excluded_from_net_worth, allow_margin, state_of_plan)
       VALUES (1, 1, NULL, NULL, 'Chase Checking', NULL, 'ACCOUNT_CASH', NULL, 0, 0, 0, NULL)`,
    );

    const txn: Omit<Transaction, 'id'> = {
      householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
      amount: 54.23, categoryId: 37 /* Shopping */, sourceAccountId: 1, propertyId: null,
      vehicleId: null, personId: 1, sourcePdfFilename: 'mar.pdf', reimbursable: true,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: 'gift',
    };
    await useTransactionsStore.getState().createMany([txn]);

    let capturedCsv = '';
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      void (b as Blob).text().then((t) => { capturedCsv = t; });
      return 'blob:mock';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    renderPage();

    const user = userEvent.setup();
    const exportButton = await screen.findByRole('button', { name: /export csv/i });
    await user.click(exportButton);
    await Promise.resolve();

    expect(capturedCsv.split('\n')[0]).toBe(
      'date,merchant,amount,category,account,person,reimbursable,notes',
    );
    expect(capturedCsv.split('\n')[1]).toBe(
      '2026-03-05,AMAZON,54.23,Shopping,Chase Checking,Alex,true,gift',
    );

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it('(h) a confirmed import with no archive folder still saves, with no warning', async () => {
    await useCategoriesStore.getState().load();
    renderPage();

    const user = userEvent.setup();
    const fileInput = screen.getByLabelText('Transactions PDF or CSV');
    // A minimal File — extractTextItems/parseStatement are mocked in this
    // suite's setup, so the bytes content is irrelevant.
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'mar.pdf', {
      type: 'application/pdf',
    });
    await user.upload(fileInput, file);

    // The review modal opens; confirm the import.
    await screen.findByText('Review transactions');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.queryByText('Review transactions')).not.toBeInTheDocument();
    });
    // No archive folder configured ⇒ no archiving warning is shown.
    expect(screen.queryByText(/could not archive/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/archive folder not found/i)).not.toBeInTheDocument();
  });

  it('(d) shows cashflow section with inflow, outflow, and net given seeded persons + transactions', async () => {
    await useCategoriesStore.getState().load();

    // Seed a person with $120,000/yr salary → $10,000/mo inflow estimate
    usePersonsStore.setState({
      persons: [
        {
          id: 1,
          householdId: 1,
          name: 'Alice',
          dateOfBirth: '1990-01-01',
          targetRetirementAge: 65,
          annualSalaryPretax: 120000,
          expectedBonus: 0,
          expectedBonusFrequency: 'ANNUAL',
          bonusIsConsistent: true,
          expectedCommission: 0,
          expectedCommissionFrequency: 'MONTHLY',
          employmentType: 'SALARY_NO_OT',
          hourlyRate: null,
          regularHoursPerWeek: 40,
          otThresholdHoursPerWeek: null,
          pretax401kPct: 0,
          healthInsuranceMonthlyPremium: 0,
          dependentCareFsaMonthly: 0,
          hsaMonthlyContribution: 0,
          hsaEligible: false,
        },
      ],
      isLoading: false,
      error: null,
    });

    // A recent transaction within the 30-day window
    const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    const txn: Omit<Transaction, 'id'> = {
      householdId: 1, date: recentDate, merchant: 'GROCERY', merchantRaw: 'GROCERY',
      amount: 200, categoryId: null, sourceAccountId: null, propertyId: null,
      vehicleId: null, personId: null, sourcePdfFilename: 'test.pdf', reimbursable: false,
      reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
    };

    await useTransactionsStore.getState().createMany([txn]);

    renderPage();

    await waitFor(() => {
      // Cashflow section heading
      expect(screen.getByText(/money in vs out/i)).toBeInTheDocument();
    });

    // Inflow label and outflow label
    await waitFor(() => {
      expect(screen.getAllByText(/money in/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/money out/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^net$/i).length).toBeGreaterThan(0);
    });
  });

  it('(e) imports a transaction CSV end-to-end via the unified import surface', async () => {
    await useCategoriesStore.getState().load();
    useHouseholdStore.setState({
      household: {
        id: 1,
        name: 'My household',
        currency: 'USD',
        monthlyExpenseBaseline: 5000,
        emergencyFundMonths: 6,
        equityCadence: 'YEARLY',
      } as never,
      isLoading: false,
      error: null,
    });
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

    renderPage();

    // Drop a CSV onto the unified file input (no separate "Import CSV" button anymore).
    const file = new File(
      ['date,account,amount,merchant,category,reimbursable\n2024-03-15,Chase Checking,20.00,STARBUCKS,,no\n'],
      'txns.csv',
      { type: 'text/csv' },
    );
    const input = screen.getByLabelText(/transactions pdf or csv/i) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await screen.findByRole('dialog');
    expect(screen.getByText(/import transactions from csv/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^commit/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const repo = new TransactionsRepo(db);
    const all = await repo.list();
    const imported = all.find((t) => t.merchant === 'STARBUCKS');
    expect(imported).toBeDefined();
    expect(imported?.amount).toBe(20);
    expect(imported?.sourceAccountId).toBe(accountId);
  });

  it('(unified-csv) routes a dropped CSV through the CSV preview modal', async () => {
    await useCategoriesStore.getState().load();
    useHouseholdStore.setState({
      household: { id: 1, name: 'My household', currency: 'USD', monthlyExpenseBaseline: 5000, emergencyFundMonths: 6, equityCadence: 'YEARLY' } as never,
      isLoading: false,
      error: null,
    });
    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1, ownerPersonId: null, beneficiaryDependentId: null,
      name: 'Chase Checking', institution: null, type: AccountType.ACCOUNT_CASH,
      cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false,
      stateOfPlan: null, accentColor: null,
    });
    useAccountsStore.setState({
      accounts: [{
        id: accountId, householdId: 1, ownerPersonId: null, beneficiaryDependentId: null,
        name: 'Chase Checking', institution: null, type: AccountType.ACCOUNT_CASH,
        cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false,
        stateOfPlan: null, accentColor: null,
      }],
      isLoading: false,
      error: null,
    });

    renderPage();

    const file = new File(
      ['date,account,amount,merchant,category,reimbursable\n2024-03-15,Chase Checking,20.00,STARBUCKS,,no\n'],
      'txns.csv',
      { type: 'text/csv' },
    );
    const input = screen.getByLabelText(/transactions pdf or csv/i) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    // The CSV preview modal opens (not the PDF Review modal).
    await screen.findByRole('dialog');
    expect(screen.getByText(/import transactions from csv/i)).toBeInTheDocument();
    expect(screen.queryByText(/review transactions/i)).toBeNull();
  });

  it('(unified-pdf) still routes a dropped PDF through the PDF review modal (regression)', async () => {
    await useCategoriesStore.getState().load();
    renderPage();

    const user = userEvent.setup();
    const fileInput = screen.getByLabelText(/transactions pdf or csv/i);
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'mar.pdf', {
      type: 'application/pdf',
    });
    await user.upload(fileInput, pdf);

    // The PDF review modal opens (not the CSV import modal).
    await screen.findByText(/review transactions/i);
    expect(screen.queryByText(/import transactions from csv/i)).toBeNull();
  });

  it('(unified-skip) silently skips unsupported file types in the drop handler', async () => {
    await useCategoriesStore.getState().load();
    renderPage();

    // Drop a .txt file — filtered out at the drop layer; no modal opens.
    const handle = screen.getByText(/drop pdfs or csvs here/i).closest('div')!;
    const txt = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const dataTransfer = { files: [txt], types: ['Files'] };
    fireEvent.drop(handle, { dataTransfer });

    // No modal opens.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/review transactions/i)).toBeNull();
  });

  it('(recurring-obligations) shows the tile when rentals/leases exist', async () => {
    await useCategoriesStore.getState().load();

    await new HousingPaymentsRepo(db).create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Apt',
      monthlyAmount: 2400,
      startDate: '2025-01-01',
      endDate: null,
    });
    await new VehicleLeasesRepo(db).create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Tesla',
      monthlyAmount: 599,
      startDate: '2025-01-01',
      endDate: null,
    });

    renderPage();

    expect(
      await screen.findByText(/Recurring obligations/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\$2,999/)).toBeInTheDocument();
  });

  it('(recurring-obligations-split) shows rent vs lease dollar breakdown', async () => {
    await useCategoriesStore.getState().load();

    await new HousingPaymentsRepo(db).create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Apt',
      monthlyAmount: 2400,
      startDate: '2025-01-01',
      endDate: null,
    });
    await new HousingPaymentsRepo(db).create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Storage',
      monthlyAmount: 95,
      startDate: '2025-01-01',
      endDate: null,
    });
    await new VehicleLeasesRepo(db).create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Tesla',
      monthlyAmount: 450,
      startDate: '2025-01-01',
      endDate: null,
    });

    renderPage();

    await screen.findByText(/Recurring obligations/i);
    // Combined total still present.
    expect(screen.getByText(/\$2,945/)).toBeInTheDocument();
    // Rent line: 2400 + 95 = 2495 across 2 rentals.
    expect(screen.getByText(/\$2,495/)).toBeInTheDocument();
    expect(screen.getByText(/Rent · 2 rentals/i)).toBeInTheDocument();
    // Lease line: 450 across 1 lease.
    expect(screen.getByText(/\$450/)).toBeInTheDocument();
    expect(screen.getByText(/Leases · 1 lease/i)).toBeInTheDocument();
  });

  it('(unified-errors) surfaces a per-file error pane when a CSV file read fails', async () => {
    await useCategoriesStore.getState().load();
    useHouseholdStore.setState({
      household: { id: 1, name: 'My household', currency: 'USD', monthlyExpenseBaseline: 5000, emergencyFundMonths: 6, equityCadence: 'YEARLY' } as never,
      isLoading: false,
      error: null,
    });
    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1, ownerPersonId: null, beneficiaryDependentId: null,
      name: 'Chase Checking', institution: null, type: AccountType.ACCOUNT_CASH,
      cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false,
      stateOfPlan: null, accentColor: null,
    });
    useAccountsStore.setState({
      accounts: [{
        id: accountId, householdId: 1, ownerPersonId: null, beneficiaryDependentId: null,
        name: 'Chase Checking', institution: null, type: AccountType.ACCOUNT_CASH,
        cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false,
        stateOfPlan: null, accentColor: null,
      }],
      isLoading: false,
      error: null,
    });

    renderPage();

    const goodFile = new File(
      ['date,account,amount,merchant,category,reimbursable\n2024-03-15,Chase Checking,20.00,STARBUCKS,,no\n'],
      'good.csv',
      { type: 'text/csv' },
    );
    const badFile = new File(['x'], 'bad.csv', { type: 'text/csv' });
    // Force the bad file's .text() to reject.
    Object.defineProperty(badFile, 'text', {
      value: () => Promise.reject(new Error('read failed')),
      configurable: true,
    });

    const input = screen.getByLabelText(/transactions pdf or csv/i) as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [goodFile, badFile], configurable: true });
    fireEvent.change(input);

    // Error pane lists the bad file.
    await waitFor(() => expect(screen.getByText(/bad\.csv/)).toBeInTheDocument());
    // The good file still opens the CSV modal.
    expect(screen.getByText(/import transactions from csv/i)).toBeInTheDocument();
  });
});
