import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { PersonsRepo } from '@/domain/persons';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType } from '@/types/enums';
import AccountsPanel from '@/components/investments/manage/AccountsPanel';

async function seedAccount(db: SqliteAdapter, name: string): Promise<number> {
  const repo = new AccountsRepo(db);
  return repo.create({
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name,
    institution: null,
    type: AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: null,
    accentColor: null,
  });
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

const realAccountsLoad = useAccountsStore.getState().load;

describe('AccountsPanel (W14 Manage surface)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: realAccountsLoad });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
    // Seed 2 persons so the owner radio renders all three options.
    await seedPerson(db, 'Alex');
    await seedPerson(db, 'Sam');
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows empty state when no accounts exist', async () => {
    render(<MemoryRouter><AccountsPanel /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/no accounts added yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /add account/i })).toBeInTheDocument();
  });

  it('shows loading, not the empty copy, while the store loads (gate discipline)', () => {
    useAccountsStore.setState({ accounts: [], isLoading: true, error: null, load: async () => {} } as never);
    render(<MemoryRouter><AccountsPanel /></MemoryRouter>);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText(/no accounts added yet/i)).not.toBeInTheDocument();
  });

  it('shows the error banner instead of empty copy when the load failed', () => {
    useAccountsStore.setState({ accounts: [], isLoading: false, error: 'DB gone', load: async () => {} } as never);
    render(<MemoryRouter><AccountsPanel /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load or save/i);
    expect(screen.queryByText(/no accounts added yet/i)).not.toBeInTheDocument();
  });

  it('Add account opens the create drawer and creates via the form', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AccountsPanel /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add account/i }));
    await user.click(screen.getByRole('button', { name: /add account/i }));

    const drawer = await screen.findByRole('dialog', { name: /add account/i });
    await user.type(within(drawer).getByLabelText(/^name$/i), 'Schwab Brokerage');
    await user.type(within(drawer).getByLabelText(/institution/i), 'Schwab');
    await user.click(within(drawer).getByRole('radio', { name: /alex/i }));
    await user.click(within(drawer).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const { accounts } = useAccountsStore.getState();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe('Schwab Brokerage');
      expect(accounts[0].institution).toBe('Schwab');
    });
    // Drawer closes on success; the list shows the new account.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Schwab Brokerage')).toBeInTheDocument();
  });

  it('Edit opens a prefilled drawer and updates the account', async () => {
    await seedAccount(db, 'OldName');
    const user = userEvent.setup();
    render(<MemoryRouter><AccountsPanel /></MemoryRouter>);
    await screen.findByText('OldName');

    await user.click(screen.getByRole('button', { name: /^edit oldname$/i }));
    const drawer = await screen.findByRole('dialog', { name: /edit account/i });
    const nameInput = within(drawer).getByLabelText(/^name$/i) as HTMLInputElement;
    expect(nameInput.value).toBe('OldName');
    await user.clear(nameInput);
    await user.type(nameInput, 'NewName');
    await user.click(within(drawer).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(useAccountsStore.getState().accounts[0].name).toBe('NewName');
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders an Import CSV button', async () => {
    render(<MemoryRouter><AccountsPanel /></MemoryRouter>);
    expect(
      await screen.findByRole('button', { name: /import csv/i }),
    ).toBeInTheDocument();
  });

  describe('delete confirmation (high-cascade)', () => {
    it('clicking Delete opens a confirm naming the collateral; Confirm removes', async () => {
      await seedAccount(db, 'Schwab Brokerage');
      const user = userEvent.setup();
      render(<MemoryRouter><AccountsPanel /></MemoryRouter>);

      await screen.findByText('Schwab Brokerage');
      await user.click(screen.getByRole('button', { name: /^delete schwab brokerage$/i }));

      expect(useAccountsStore.getState().accounts).toHaveLength(1);
      expect(await screen.findByText(/delete schwab brokerage\?/i)).toBeInTheDocument();
      expect(
        screen.getByText(/snapshots, holdings, and contribution history/i),
      ).toBeInTheDocument();

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
      await waitFor(() =>
        expect(useAccountsStore.getState().accounts).toHaveLength(0),
      );
      expect(screen.getByText(/no accounts added yet/i)).toBeInTheDocument();
    });

    it('Cancel keeps the account', async () => {
      await seedAccount(db, 'Schwab Brokerage');
      const user = userEvent.setup();
      render(<MemoryRouter><AccountsPanel /></MemoryRouter>);

      await screen.findByText('Schwab Brokerage');
      await user.click(screen.getByRole('button', { name: /^delete schwab brokerage$/i }));
      await screen.findByText(/delete schwab brokerage\?/i);
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() =>
        expect(screen.queryByText(/delete schwab brokerage\?/i)).not.toBeInTheDocument(),
      );
      expect(useAccountsStore.getState().accounts).toHaveLength(1);
    });
  });
});
