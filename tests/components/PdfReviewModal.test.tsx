import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { useMerchantOverridesStore } from '@/stores/merchant-overrides-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { PersonsRepo } from '@/domain/persons';
import { TransactionsRepo } from '@/domain/transactions';
import { PropertiesRepo } from '@/domain/properties';
import { PdfReviewModal } from '@/components/dialogs/PdfReviewModal';
import { usePersonsStore } from '@/stores/persons-store';
import { getDatabase } from '@/db/db';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Issuer, PropertyType } from '@/types/enums';
import type { ParseResult } from '@/pdf/parse-statement';
import type { Transaction } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

function makeResult(transactions: ParseResult['transactions']): ParseResult {
  return { issuer: Issuer.GENERIC, transactions };
}

function renderModal(
  result: ParseResult,
  existing: Transaction[],
  onClose = vi.fn(),
  onSaved = vi.fn(),
) {
  return render(
    <MemoryRouter>
      <PdfReviewModal
        result={result}
        filename="test.pdf"
        existing={existing}
        onClose={onClose}
        onSaved={onSaved}
      />
    </MemoryRouter>,
  );
}

describe('PdfReviewModal', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0003_add_commission_columns'),
      mig('0005_add_employment_and_bonus_columns'),
      mig('0008_add_transaction_property_links'),
      mig('0012_add_transaction_person'),
      mig('0009_seed_categories'),
      mig('0010_seed_merchant_mappings'),
      mig('0013_add_category_budget'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useMerchantOverridesStore.setState({ overrides: [], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('(a) renders one row per parsed transaction with auto-categorized category preselected', async () => {
    const result = makeResult([
      { date: '2026-03-05', merchantRaw: 'WHOLE FOODS MARKET', merchant: 'WHOLE FOODS MARKET', amount: 54.23 },
      { date: '2026-03-06', merchantRaw: 'NETFLIX.COM', merchant: 'NETFLIX', amount: 15.49 },
    ]);
    renderModal(result, []);

    // Should render the dialog
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Should eventually render both merchant names
    await waitFor(() => {
      expect(screen.getByDisplayValue('WHOLE FOODS MARKET')).toBeInTheDocument();
      expect(screen.getByDisplayValue('NETFLIX')).toBeInTheDocument();
    });

    // Category selects should be preselected to the categorize() prediction:
    // WHOLE FOODS MARKET → merchant_seed pattern 'WHOLE FOODS' → category id 33 (Groceries)
    // NETFLIX → merchant_seed pattern 'NETFLIX' → category id 39 (Subscriptions)
    const categorySelects = screen.getAllByRole('combobox', { name: /category for/i });
    expect(categorySelects).toHaveLength(2);
    // Row order is date-sorted: 2026-03-05 (WHOLE FOODS) first, 2026-03-06 (NETFLIX) second
    expect(categorySelects[0]).toHaveValue('33');
    expect(categorySelects[1]).toHaveValue('39');
  });

  it('(b) a row whose dedup key matches an existing transaction renders unchecked with duplicate badge', async () => {
    const txn: ParseResult['transactions'][0] = {
      date: '2026-03-05', merchantRaw: 'AMAZON.COM', merchant: 'AMAZON', amount: 54.23,
    };
    const result = makeResult([txn]);
    const existing: Transaction[] = [{
      id: 1, householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
      amount: 54.23, categoryId: null, sourceAccountId: null, propertyId: null, vehicleId: null,
      personId: null, sourcePdfFilename: null, reimbursable: false, reimbursedAt: null,
      reimbursedAmount: null, isRecurring: false, notes: null,
    }];

    renderModal(result, existing);

    await waitFor(() => {
      expect(screen.getByDisplayValue('AMAZON')).toBeInTheDocument();
    });

    // The include checkbox should be unchecked
    const checkbox = screen.getByRole('checkbox', { name: /include amazon/i });
    expect(checkbox).not.toBeChecked();

    // The duplicate badge should be visible
    expect(screen.getByText('duplicate')).toBeInTheDocument();
  });

  it('(c) clicking Save calls onSaved with count of checked rows and rows land in transactions', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    const result = makeResult([
      { date: '2026-03-05', merchantRaw: 'STARBUCKS #123', merchant: 'STARBUCKS', amount: 7.50 },
      { date: '2026-03-06', merchantRaw: 'NETFLIX.COM', merchant: 'NETFLIX', amount: 15.49 },
    ]);
    renderModal(result, [], vi.fn(), onSaved);

    // Wait for rows to appear
    await waitFor(() => {
      expect(screen.getByDisplayValue('STARBUCKS')).toBeInTheDocument();
    });

    // Both rows should be checked by default (no duplicates)
    const checkboxes = screen.getAllByRole('checkbox', { name: /include/i });
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).toBeChecked();

    // Uncheck second row
    await user.click(checkboxes[1]);
    expect(checkboxes[1]).not.toBeChecked();

    // Save
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // onSaved should be called with 1 (only first row was included)
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(1);
    });

    // The transaction should be in the DB
    const { transactions } = useTransactionsStore.getState();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].merchant).toBe('STARBUCKS');
  });

  it('(e) attributes an imported transaction to the selected person', async () => {
    // Persons must be in the DB — the modal's init effect calls
    // usePersonsStore.getState().load(), which overwrites any setState seed.
    const person = (name: string) => ({
      householdId: 1, name, dateOfBirth: '1990-01-01', targetRetirementAge: 65,
      annualSalaryPretax: 0, expectedBonus: 0, expectedBonusFrequency: 'ANNUAL' as const,
      bonusIsConsistent: true, expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY' as const,
      employmentType: 'SALARY_NO_OT' as const, hourlyRate: null,
      regularHoursPerWeek: 40, otThresholdHoursPerWeek: null, pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0, dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0, hsaEligible: false,
    });
    const personsRepo = new PersonsRepo(db);
    await personsRepo.create(person('Alex'));
    await personsRepo.create(person('Sam'));

    const result: ParseResult = {
      issuer: Issuer.CHASE,
      transactions: [
        { date: '2026-03-05', merchantRaw: 'STARBUCKS #1', merchant: 'STARBUCKS', amount: 7.5 },
      ],
    };

    render(
      <PdfReviewModal result={result} filename="mar.pdf" existing={[]}
        onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const user = userEvent.setup();
    const personSelect = await screen.findByLabelText(/person for STARBUCKS/i);
    await user.selectOptions(personSelect, '2');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(async () => {
      const rows = await new TransactionsRepo(db).list();
      expect(rows).toHaveLength(1);
      expect(rows[0].personId).toBe(2);
    });
  });

  it('(d) property select renders and auto-selects for a Home-child category when exactly one property exists', async () => {
    // Seed exactly one property into the DB
    const repo = new PropertiesRepo(getDatabase());
    const propertyId = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Main House',
      type: PropertyType.PRIMARY_RESIDENCE,
      address: null,
      purchaseDate: null,
      purchasePrice: null,
      currentEstimatedValue: null,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });

    // Render with a transaction; we will manually set its category to
    // "Capital Improvements" (id=12, parentCategoryId=1 i.e. Home) after mount.
    const result = makeResult([
      { date: '2026-04-01', merchantRaw: 'CONTRACTORS INC', merchant: 'CONTRACTORS INC', amount: 3500.00 },
    ]);
    renderModal(result, []);

    // Wait for the merchant row to appear
    await waitFor(() => {
      expect(screen.getByDisplayValue('CONTRACTORS INC')).toBeInTheDocument();
    });

    // Change category to Capital Improvements (id=12) — a Home child
    const categorySelect = screen.getByRole('combobox', { name: /category for contractors inc/i });
    await userEvent.selectOptions(categorySelect, '12');

    // The property sub-select should now appear and be auto-selected to the seeded property
    await waitFor(() => {
      const propertySelect = screen.getByRole('combobox', { name: /property for contractors inc/i });
      expect(propertySelect).toBeInTheDocument();
      expect(propertySelect).toHaveValue(String(propertyId));
    });
  });
});
