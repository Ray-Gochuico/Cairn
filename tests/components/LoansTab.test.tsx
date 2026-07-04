import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { PersonsRepo } from '@/domain/persons';
import { LoanType } from '@/types/enums';
import LoansTab from '@/pages/inputs/LoansTab';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');

async function selectDate(user: UserEvent, pickerId: string, isoDate: string) {
  const [yyyy, mm, dd] = isoDate.split('-');
  const root = screen.getByTestId(`${pickerId}-picker`);
  await user.selectOptions(within(root).getByLabelText(/year$/i), yyyy);
  await user.selectOptions(within(root).getByLabelText(/month$/i), mm);
  await user.selectOptions(within(root).getByLabelText(/day$/i), dd);
}

async function seedPerson(db: SqliteAdapter, name: string): Promise<number> {
  const repo = new PersonsRepo(db);
  return repo.create({
    householdId: 1,
    name,
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: 100000,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
  });
}

describe('LoansTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
    ]);
    setDatabase(db);
    useLoansStore.setState({ loans: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
    // Seed 2 persons so the obligor radio renders all three options.
    await seedPerson(db, 'Alex');
    await seedPerson(db, 'Sam');
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows empty state when no loans exist', async () => {
    render(<MemoryRouter><LoansTab /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/no loans added yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /add loan/i })).toBeInTheDocument();
  });

  it('opens the add-loan form when clicking Add Loan', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoansTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add loan/i }));
    await user.click(screen.getByRole('button', { name: /add loan/i }));
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/original amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/current balance/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/interest rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/term \(months\)/i)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /first payment date/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/monthly payment/i)).toBeInTheDocument();
  });

  it('auto-populates monthly payment on blur from amortization inputs', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoansTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add loan/i }));
    await user.click(screen.getByRole('button', { name: /add loan/i }));

    // Fill in the four inputs that drive amortization
    const original = screen.getByLabelText(/original amount/i);
    const balance = screen.getByLabelText(/current balance/i);
    const rate = screen.getByLabelText(/interest rate/i);
    const term = screen.getByLabelText(/term \(months\)/i);
    const monthly = screen.getByLabelText(/monthly payment/i) as HTMLInputElement;

    await user.type(original, '400000');
    await user.type(balance, '400000');
    await user.type(rate, '0.06');
    await selectDate(user, 'firstPaymentDate', '2024-06-01');
    // term already defaults to 360; clear and re-type to trigger blur
    await user.clear(term);
    await user.type(term, '360');
    // Move focus off term to trigger onBlur
    await user.tab();

    // Standard 30-year 6% on 400k → ~2398.20
    await waitFor(() => {
      expect(Number(monthly.value)).toBeCloseTo(2398.20, 1);
    });
  });

  it('creates a loan via the form', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoansTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add loan/i }));
    await user.click(screen.getByRole('button', { name: /add loan/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'Primary Mortgage');
    await user.type(screen.getByLabelText(/original amount/i), '400000');
    await user.type(screen.getByLabelText(/current balance/i), '400000');
    await user.type(screen.getByLabelText(/interest rate/i), '0.06');
    await selectDate(user, 'firstPaymentDate', '2024-06-01');
    // Pick Alex as obligor via the radio
    await user.click(screen.getByRole('radio', { name: /alex/i }));
    // term defaults to 360 — tabbing off triggers monthly payment auto-fill
    await user.tab();

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const { loans } = useLoansStore.getState();
      expect(loans).toHaveLength(1);
      expect(loans[0].name).toBe('Primary Mortgage');
      expect(loans[0].type).toBe(LoanType.MORTGAGE);
      expect(loans[0].currentBalance).toBe(400000);
      expect(loans[0].monthlyPayment).toBeGreaterThan(0);
    });

    expect(await screen.findByText('Primary Mortgage')).toBeInTheDocument();
  });

  it('opens edit form pre-filled and updates the loan', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><LoansTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add loan/i }));

    // Create one first
    await user.click(screen.getByRole('button', { name: /add loan/i }));
    await user.type(screen.getByLabelText(/^name$/i), 'OldName');
    await user.type(screen.getByLabelText(/original amount/i), '100000');
    await user.type(screen.getByLabelText(/current balance/i), '100000');
    await user.type(screen.getByLabelText(/interest rate/i), '0.05');
    await selectDate(user, 'firstPaymentDate', '2023-01-01');
    await user.click(screen.getByRole('radio', { name: /alex/i }));
    await user.tab();
    await user.click(screen.getByRole('button', { name: /save/i }));

    await screen.findByText('OldName');

    // Now edit
    await user.click(screen.getByRole('button', { name: /edit/i }));
    const nameInput = await screen.findByLabelText(/^name$/i);
    expect((nameInput as HTMLInputElement).value).toBe('OldName');
    await user.clear(nameInput);
    await user.type(nameInput, 'NewName');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const { loans } = useLoansStore.getState();
      expect(loans[0].name).toBe('NewName');
    });
  });

  it('renders an Import CSV button in the page header', async () => {
    render(<MemoryRouter><LoansTab /></MemoryRouter>);
    expect(
      await screen.findByRole('button', { name: /import csv/i }),
    ).toBeInTheDocument();
  });

  it('Import CSV button has the hidden file input wired', async () => {
    render(<MemoryRouter><LoansTab /></MemoryRouter>);
    expect(
      await screen.findByTestId('import-csv-file-input'),
    ).toBeInTheDocument();
  });
});
