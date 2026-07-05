import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { usePropertiesStore } from '@/stores/properties-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useLoansStore } from '@/stores/loans-store';
import { PersonsRepo } from '@/domain/persons';
import { LoansRepo } from '@/domain/loans';
import { PropertiesRepo } from '@/domain/properties';
import { LoanType, PropertyType } from '@/types/enums';
import PropertiesTab from '@/pages/inputs/PropertiesTab';

describe('PropertiesTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useLoansStore.setState({ loans: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders an Import CSV button in the page header', async () => {
    render(<MemoryRouter><PropertiesTab /></MemoryRouter>);
    expect(
      await screen.findByRole('button', { name: /import csv/i }),
    ).toBeInTheDocument();
  });

  it('Import CSV button has the hidden file input wired', async () => {
    render(<MemoryRouter><PropertiesTab /></MemoryRouter>);
    expect(
      await screen.findByTestId('import-csv-file-input'),
    ).toBeInTheDocument();
  });

  // Round-2 A4: excluding a property hides the asset but its linked mortgage
  // still counts — the form + list row must disclose the asymmetry.
  // Seed: one person (PropertyForm needs one), one mortgage, one linked property.
  async function seedLinkedPair(excluded: boolean) {
    await new PersonsRepo(db).create({
      householdId: 1,
      name: 'Alex',
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
    const loanId = await new LoansRepo(db).create({
      householdId: 1, obligorPersonId: null, name: 'Home mortgage', type: LoanType.MORTGAGE,
      originalAmount: 400000, currentBalance: 350000, interestRate: 0.06, termMonths: 360,
      firstPaymentDate: '2020-01-01', monthlyPayment: 2400, extraPaymentDefault: 0,
      linkedPropertyId: null, linkedVehicleId: null,
    });
    await new PropertiesRepo(db).create({
      householdId: 1, ownerPersonId: null, name: 'House', type: PropertyType.PRIMARY_RESIDENCE,
      address: null, purchaseDate: null, purchasePrice: null, currentEstimatedValue: 500000,
      linkedLoanId: loanId, excludedFromNetWorth: excluded,
    });
  }

  it('editing an excluded property with a linked mortgage shows the still-counts note (round-2 A4)', async () => {
    const user = userEvent.setup();
    await seedLinkedPair(true);
    render(<MemoryRouter><PropertiesTab /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByTestId('excluded-linked-loan-note')).toHaveTextContent(
      /linked mortgage still counts toward net worth/i,
    );

    // The note reacts LIVE: unchecking the exclusion removes it.
    await user.click(screen.getByLabelText(/exclude from net worth/i));
    await waitFor(() => {
      expect(screen.queryByTestId('excluded-linked-loan-note')).not.toBeInTheDocument();
    });
  });

  it('the note is absent while the property is not excluded', async () => {
    const user = userEvent.setup();
    await seedLinkedPair(false);
    render(<MemoryRouter><PropertiesTab /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByLabelText(/exclude from net worth/i)).not.toBeChecked();
    expect(screen.queryByTestId('excluded-linked-loan-note')).not.toBeInTheDocument();
  });

  it('the list row flags the pair: "excluded from net worth (linked mortgage still counts)"', async () => {
    await seedLinkedPair(true);
    render(<MemoryRouter><PropertiesTab /></MemoryRouter>);
    expect(await screen.findByText(/linked mortgage still counts/i)).toBeInTheDocument();
  });
});
