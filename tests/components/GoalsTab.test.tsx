import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useGoalsStore } from '@/stores/goals-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { PersonsRepo } from '@/domain/persons';
import { AccountsRepo } from '@/domain/accounts';
import { GoalsRepo } from '@/domain/goals';
import { AccountType, GoalType } from '@/types/enums';
import GoalsTab from '@/pages/inputs/GoalsTab';
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
const loadAccentColorsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0015_add_accent_colors.sql'), 'utf-8');
const loadAppSettingsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0014_add_app_settings.sql'), 'utf-8');
const loadCashApyMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0024_cash_apy.sql'), 'utf-8');

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

async function seedAccount(db: SqliteAdapter, name: string, institution: string | null = null): Promise<number> {
  const repo = new AccountsRepo(db);
  return repo.create({
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name,
    institution,
    type: AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: null,
      accentColor: null,
  });
}

async function seedGoal(
  db: SqliteAdapter,
  overrides: Partial<{
    forPersonId: number | null;
    name: string;
    type: GoalType;
    targetAmount: number;
    targetDate: string;
    linkedAccountIds: number[];
  }> = {},
): Promise<number> {
  const repo = new GoalsRepo(db);
  return repo.create({
    householdId: 1,
    forPersonId: overrides.forPersonId ?? null,
    name: overrides.name ?? 'Emergency Fund',
    type: overrides.type ?? GoalType.EMERGENCY_FUND,
    targetAmount: overrides.targetAmount ?? 25000,
    targetDate: overrides.targetDate ?? '2030-01-01',
    linkedAccountIds: overrides.linkedAccountIds ?? [],
  });
}

describe('GoalsTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
      { version: '0014_add_app_settings', sql: loadAppSettingsMigration() },
      { version: '0024_cash_apy', sql: loadCashApyMigration() },
    ]);
    setDatabase(db);
    useGoalsStore.setState({ goals: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    // Seed 2 persons so the For radio renders Household + 2 person options.
    await seedPerson(db, 'Alex');
    await seedPerson(db, 'Sam');
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows empty state when no goals exist', async () => {
    render(<MemoryRouter><GoalsTab /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/no goals added yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /add a goal/i })).toBeInTheDocument();
  });

  it('opens the add-goal form when clicking Add a goal', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><GoalsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a goal/i }));
    await user.click(screen.getByRole('button', { name: /add a goal/i }));
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target amount/i)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /target date/i })).toBeInTheDocument();
  });

  it('creates a goal via the form', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><GoalsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a goal/i }));
    await user.click(screen.getByRole('button', { name: /add a goal/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'House Down Payment');
    await user.selectOptions(screen.getByLabelText(/^type$/i), GoalType.DOWN_PAYMENT);
    await user.clear(screen.getByLabelText(/target amount/i));
    await user.type(screen.getByLabelText(/target amount/i), '80000');
    await selectDate(user, 'targetDate', '2032-06-01');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const { goals } = useGoalsStore.getState();
      expect(goals).toHaveLength(1);
      expect(goals[0].name).toBe('House Down Payment');
      expect(goals[0].type).toBe(GoalType.DOWN_PAYMENT);
      expect(goals[0].targetAmount).toBe(80000);
      expect(goals[0].targetDate).toBe('2032-06-01');
      expect(goals[0].forPersonId).toBeNull();
    });

    // Returned to list view
    expect(await screen.findByText('House Down Payment')).toBeInTheDocument();
  });

  it('opens the edit form when clicking Edit on a goal', async () => {
    const user = userEvent.setup();
    await seedGoal(db, { name: 'Retirement Pot', type: GoalType.RETIREMENT, targetAmount: 1500000, targetDate: '2055-01-01' });
    render(<MemoryRouter><GoalsTab /></MemoryRouter>);
    await waitFor(() => screen.getByText('Retirement Pot'));

    await user.click(screen.getByRole('button', { name: /edit/i }));

    const nameInput = await screen.findByLabelText(/^name$/i);
    expect((nameInput as HTMLInputElement).value).toBe('Retirement Pot');

    await user.clear(nameInput);
    await user.type(nameInput, 'Big Retirement');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const { goals } = useGoalsStore.getState();
      expect(goals[0].name).toBe('Big Retirement');
    });
  });

  it('lists multiple goals with type label and amount', async () => {
    await seedGoal(db, { name: 'Emergency Fund', type: GoalType.EMERGENCY_FUND, targetAmount: 25000 });
    await seedGoal(db, { name: 'College Savings', type: GoalType.EDUCATION, targetAmount: 100000 });

    render(<MemoryRouter><GoalsTab /></MemoryRouter>);
    await waitFor(() => screen.getByText('Emergency Fund'));
    expect(screen.getByText('College Savings')).toBeInTheDocument();
    // Type labels show via GOAL_TYPE_LABELS
    expect(screen.getAllByText(/Emergency fund/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Education/i).length).toBeGreaterThan(0);
  });

  it('switches forPersonId radio between Household and a person', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><GoalsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a goal/i }));
    await user.click(screen.getByRole('button', { name: /add a goal/i }));

    // Household is the default
    const householdRadio = screen.getByRole('radio', { name: /household/i }) as HTMLInputElement;
    expect(householdRadio.checked).toBe(true);

    // Switch to Alex
    await user.click(screen.getByRole('radio', { name: /^alex$/i }));
    const alexRadio = screen.getByRole('radio', { name: /^alex$/i }) as HTMLInputElement;
    expect(alexRadio.checked).toBe(true);
    expect(householdRadio.checked).toBe(false);

    // Fill required fields and save to confirm the value persists
    await user.type(screen.getByLabelText(/^name$/i), 'Alex Goal');
    await user.clear(screen.getByLabelText(/target amount/i));
    await user.type(screen.getByLabelText(/target amount/i), '5000');
    await selectDate(user, 'targetDate', '2030-01-01');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const { goals } = useGoalsStore.getState();
      expect(goals).toHaveLength(1);
      expect(goals[0].forPersonId).not.toBeNull();
    });
  });

  it('toggles linkedAccountIds checkboxes', async () => {
    const user = userEvent.setup();
    const acctA = await seedAccount(db, 'Schwab Brokerage', 'Schwab');
    await seedAccount(db, 'Fidelity 401k', 'Fidelity');

    render(<MemoryRouter><GoalsTab /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add a goal/i }));
    await user.click(screen.getByRole('button', { name: /add a goal/i }));

    const schwabCheckbox = screen.getByRole('checkbox', { name: /schwab brokerage/i }) as HTMLInputElement;
    expect(schwabCheckbox.checked).toBe(false);
    await user.click(schwabCheckbox);
    expect(schwabCheckbox.checked).toBe(true);

    await user.type(screen.getByLabelText(/^name$/i), 'Linked Goal');
    await user.clear(screen.getByLabelText(/target amount/i));
    await user.type(screen.getByLabelText(/target amount/i), '10000');
    await selectDate(user, 'targetDate', '2031-01-01');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const { goals } = useGoalsStore.getState();
      expect(goals).toHaveLength(1);
      expect(goals[0].linkedAccountIds).toEqual([acctA]);
    });
  });
});
