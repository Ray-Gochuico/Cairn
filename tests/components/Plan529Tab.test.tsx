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
import { useHouseholdStore } from '@/stores/household-store';
import { PersonsRepo } from '@/domain/persons';
import { DependentsRepo } from '@/domain/dependents';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType, DependentType, FilingStatus } from '@/types/enums';
import type { GrowthScenario } from '@/types/schema';
import Plan529Tab from '@/pages/inputs/Plan529Tab';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');
const loadAccountMarginMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0007_add_account_margin.sql'), 'utf-8');

const moderateScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
  { label: 'Bull', rate: 0.08 },
];

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

async function seedAccount(
  db: SqliteAdapter,
  overrides: Partial<{
    name: string;
    type: AccountType;
    ownerPersonId: number | null;
    beneficiaryDependentId: number | null;
    stateOfPlan: string | null;
  }>,
): Promise<number> {
  const repo = new AccountsRepo(db);
  return repo.create({
    householdId: 1,
    ownerPersonId: overrides.ownerPersonId ?? null,
    beneficiaryDependentId: overrides.beneficiaryDependentId ?? null,
    name: overrides.name ?? 'Account',
    institution: null,
    type: overrides.type ?? AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: overrides.stateOfPlan ?? null,
  });
}

function setHouseholdState(state: string, filingStatus: FilingStatus = FilingStatus.MFJ) {
  // Override load() to a no-op so the component's mount-time refresh from the
  // SQLite singleton (state='CA' from migration 0001) doesn't clobber the value
  // we're seeding here for this assertion.
  useHouseholdStore.setState({
    household: {
      filingStatus,
      state,
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: moderateScenarios,
    },
    isLoading: false,
    error: null,
    load: async () => {},
  });
}

describe('Plan529Tab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
    ]);
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    // Seed two persons (matches AccountsTab pattern: owner radios appear).
    await seedPerson(db, 'Alex');
    await seedPerson(db, 'Sam');
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows empty state when no 529 plans exist', async () => {
    render(<MemoryRouter><Plan529Tab /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/no 529 plans added yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /add a 529 plan/i })).toBeInTheDocument();
  });

  it('filters out non-529 accounts from the list', async () => {
    await seedDependent(db, 'Junior');
    const dep = (await new DependentsRepo(db).list())[0];
    await seedAccount(db, {
      name: 'Schwab Brokerage',
      type: AccountType.ACCOUNT_BROKERAGE,
      ownerPersonId: 1,
    });
    await seedAccount(db, {
      name: 'NY 529 for Junior',
      type: AccountType.ACCOUNT_529,
      ownerPersonId: 1,
      beneficiaryDependentId: dep.id!,
      stateOfPlan: 'NY',
    });

    render(<MemoryRouter><Plan529Tab /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('NY 529 for Junior')).toBeInTheDocument();
    });
    expect(screen.queryByText('Schwab Brokerage')).not.toBeInTheDocument();
  });

  it('shows deduction tooltip when household state is in the deduction table', async () => {
    setHouseholdState('NY', FilingStatus.MFJ);
    render(<MemoryRouter><Plan529Tab /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/your state \(NY\) allows up to/i)).toBeInTheDocument();
    });
    // NY MFJ = $10,000.
    expect(screen.getByText(/\$10,000/)).toBeInTheDocument();
    // Phase 5 disclaimer.
    expect(screen.getByText(/phase 5 what-if/i)).toBeInTheDocument();
  });

  it('hides deduction tooltip when household state is not in the deduction table', async () => {
    setHouseholdState('CA', FilingStatus.SINGLE);
    render(<MemoryRouter><Plan529Tab /></MemoryRouter>);
    // Wait for the empty state (proves the tab has rendered) then assert the tooltip is gone.
    await waitFor(() => {
      expect(screen.getByText(/no 529 plans added yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/allows up to/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/state income tax deduction/i)).not.toBeInTheDocument();
  });

  it('opens the create form pre-filled with type=ACCOUNT_529', async () => {
    const user = userEvent.setup();
    await seedDependent(db, 'Junior');
    render(<MemoryRouter><Plan529Tab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a 529 plan/i }));

    await user.click(screen.getByRole('button', { name: /add a 529 plan/i }));

    // Type select should default to 529.
    const typeSelect = await screen.findByLabelText(/^type$/i);
    expect((typeSelect as HTMLSelectElement).value).toBe(AccountType.ACCOUNT_529);
    // 529-specific fields should be visible without changing the type.
    expect(screen.getByLabelText(/beneficiary/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/state of plan/i)).toBeInTheDocument();
  });

  it('creates a 529 plan via the form', async () => {
    const user = userEvent.setup();
    await seedDependent(db, 'Junior');

    render(<MemoryRouter><Plan529Tab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a 529 plan/i }));

    await user.click(screen.getByRole('button', { name: /add a 529 plan/i }));
    await user.type(screen.getByLabelText(/^name$/i), "Junior's NY 529");
    await user.click(screen.getByRole('radio', { name: /alex/i }));
    // Pick the dependent as beneficiary.
    await user.selectOptions(screen.getByLabelText(/beneficiary/i), '1');
    await user.type(screen.getByLabelText(/state of plan/i), 'ny');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const { accounts } = useAccountsStore.getState();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe("Junior's NY 529");
      expect(accounts[0].type).toBe(AccountType.ACCOUNT_529);
      expect(accounts[0].beneficiaryDependentId).toBe(1);
      expect(accounts[0].stateOfPlan).toBe('NY');
    });

    // Returns to list view and shows the new plan.
    expect(await screen.findByText("Junior's NY 529")).toBeInTheDocument();
  });
});
