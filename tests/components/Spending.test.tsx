import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

// pdfjs-dist uses DOMMatrix which is not available in jsdom. Mock the extract
// module so the Spending page can be imported without pulling in pdfjs.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
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
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('(a) renders the import button and an empty-state message when there are no transactions', async () => {
    renderPage();

    // Import button should be visible
    expect(screen.getByRole('button', { name: /import statement/i })).toBeInTheDocument();

    // File input for drag-and-drop should be present
    expect(screen.getByLabelText(/statement pdf/i)).toBeInTheDocument();

    // Empty state message
    await waitFor(() => {
      expect(
        screen.getByText(/no transactions yet/i),
      ).toBeInTheDocument();
    });
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
});
