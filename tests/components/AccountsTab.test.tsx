import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { PersonsRepo } from '@/domain/persons';
import { DependentsRepo } from '@/domain/dependents';
import { AccountType, DependentType } from '@/types/enums';
import AccountsTab from '@/pages/inputs/AccountsTab';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');

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

async function seedDependent(db: SqliteAdapter, name: string): Promise<number> {
  const repo = new DependentsRepo(db);
  return repo.create({
    householdId: 1,
    name,
    dateOfBirth: '2018-05-15',
    type: DependentType.CHILD,
  });
}

describe('AccountsTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
    ]);
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
    // Seed 2 persons so the owner radio renders all three options (Person 1 / Person 2 / Joint).
    await seedPerson(db, 'Alex');
    await seedPerson(db, 'Sam');
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows empty state when no accounts exist', async () => {
    render(<MemoryRouter><AccountsTab /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/no accounts added yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /add account/i })).toBeInTheDocument();
  });

  it('opens the add-account form when clicking Add Account', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AccountsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add account/i }));
    await user.click(screen.getByRole('button', { name: /add account/i }));
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
  });

  it('creates an account via the form', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AccountsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add account/i }));
    await user.click(screen.getByRole('button', { name: /add account/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'Schwab Brokerage');
    await user.type(screen.getByLabelText(/institution/i), 'Schwab');
    // Pick Alex as owner via the radio
    await user.click(screen.getByRole('radio', { name: /alex/i }));

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const { accounts } = useAccountsStore.getState();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Schwab Brokerage');
      expect(accounts[0].institution).toBe('Schwab');
      expect(accounts[0].type).toBe(AccountType.ACCOUNT_BROKERAGE);
    });

    // List re-renders with the new account
    expect(await screen.findByText('Schwab Brokerage')).toBeInTheDocument();
  });

  it('opens edit form pre-filled and updates the account', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AccountsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add account/i }));

    // Create one first
    await user.click(screen.getByRole('button', { name: /add account/i }));
    await user.type(screen.getByLabelText(/^name$/i), 'OldName');
    await user.click(screen.getByRole('radio', { name: /alex/i }));
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
      const { accounts } = useAccountsStore.getState();
      expect(accounts[0].name).toBe('NewName');
    });
  });

  it('shows the 529 beneficiary picker when type is 529', async () => {
    const user = userEvent.setup();
    await seedDependent(db, 'Junior');

    render(<MemoryRouter><AccountsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add account/i }));
    await user.click(screen.getByRole('button', { name: /add account/i }));

    // Initially no beneficiary picker
    expect(screen.queryByLabelText(/beneficiary/i)).not.toBeInTheDocument();

    // Change type to 529 via the native select
    const typeSelect = screen.getByLabelText(/^type$/i) as HTMLSelectElement;
    await user.selectOptions(typeSelect, AccountType.ACCOUNT_529);

    // Now the beneficiary picker appears
    expect(screen.getByLabelText(/beneficiary/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/state of plan/i)).toBeInTheDocument();
  });
});
