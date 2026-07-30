import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { AccountType, DependentType, FilingStatus } from '@/types/enums';
import type { Account } from '@/types/schema';
import { Plan529Section } from '@/components/goals/Plan529Section';

// Adapted from tests/components/Plan529Tab.test.tsx (W14: 529 management
// moved onto Goals) — converted from the DB-backed tab pattern to the house
// store-seeding pattern; the tab file + its tests are retired in Wave 14b.

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    householdId: 1,
    ownerPersonId: 1,
    beneficiaryDependentId: null,
    name: '529 Plan',
    institution: null,
    type: AccountType.ACCOUNT_529,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
    accentColor: null,
    apyRate: null,
    hasEmployerMatch: false,
    employerMatchPct: null,
    employerMatchLimitPct: null,
    allowsMegaBackdoorRollover: false,
    ...overrides,
  } as Account;
}

function seedHousehold(state: string, filingStatus: FilingStatus = FilingStatus.MFJ) {
  useHouseholdStore.setState({
    household: {
      filingStatus,
      state,
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: [],
    },
    isLoading: false,
    error: null,
    load: async () => {},
  });
}

function resetStores() {
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} });
  usePersonsStore.setState({
    persons: [{ id: 1, householdId: 1, name: 'Alex' }] as never,
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useDependentsStore.setState({
    dependents: [{ id: 1, householdId: 1, name: 'Junior', dateOfBirth: '2018-05-15', type: DependentType.CHILD }] as never,
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as never);
  seedHousehold('CA', FilingStatus.SINGLE);
}

function renderSection() {
  return render(
    <MemoryRouter>
      <Plan529Section />
    </MemoryRouter>,
  );
}

describe('Plan529Section (W14: 529 plans live with Goals)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders only 529 plans with beneficiary + state resolved', () => {
    useAccountsStore.setState({
      accounts: [
        makeAccount({ id: 1, name: 'Schwab Brokerage', type: AccountType.ACCOUNT_BROKERAGE }),
        makeAccount({ id: 2, name: 'NY 529 for Junior', beneficiaryDependentId: 1, stateOfPlan: 'NY' }),
      ],
    });
    renderSection();
    expect(screen.getByText(/529 college savings/i)).toBeInTheDocument();
    expect(screen.getByText('NY 529 for Junior')).toBeInTheDocument();
    expect(screen.queryByText('Schwab Brokerage')).toBeNull();
    // Meta line resolves the beneficiary name + the plan's state.
    expect(screen.getByText(/^for Junior/)).toBeInTheDocument();
    expect(screen.getByText(/· NY/)).toBeInTheDocument();
  });

  it('shows the latest snapshot value for a plan', () => {
    useAccountsStore.setState({
      accounts: [makeAccount({ id: 2, name: 'NY 529', stateOfPlan: 'NY' })],
    });
    useSnapshotsStore.setState({
      snapshots: [
        { id: 1, accountId: 2, snapshotDate: '2026-05-31', totalValue: 12_000 },
        { id: 2, accountId: 2, snapshotDate: '2026-06-30', totalValue: 12_500 },
      ] as never,
    } as never);
    renderSection();
    expect(screen.getByText(/\$12,500/)).toBeInTheDocument();
    expect(screen.queryByText(/\$12,000/)).toBeNull();
  });

  it('surfaces the state-deduction hint for a deductible state (lifted from Plan529Tab)', () => {
    seedHousehold('NY', FilingStatus.MFJ);
    renderSection();
    expect(screen.getByText(/your state \(NY\) allows up to/i)).toBeInTheDocument();
    expect(screen.getByText(/\$10,000/)).toBeInTheDocument();
    expect(screen.queryByText(/phase 5/i)).toBeNull();
  });

  it('hides the deduction hint when the state has none', () => {
    seedHousehold('CA', FilingStatus.SINGLE);
    renderSection();
    expect(screen.queryByText(/allows up to/i)).toBeNull();
  });

  it('gated empty state: quiet while loading, calm one-liner when settled-empty', () => {
    useAccountsStore.setState({ accounts: [], isLoading: true });
    const { unmount } = renderSection();
    expect(screen.queryByText(/no 529 plans yet/i)).toBeNull();
    unmount();
    useAccountsStore.setState({ accounts: [], isLoading: false });
    renderSection();
    expect(screen.getByText(/no 529 plans yet/i)).toBeInTheDocument();
  });

  it('"Add 529 plan" opens the drawer with type preset; saving calls create with ACCOUNT_529', async () => {
    const createSpy = vi.fn(async () => 1);
    useAccountsStore.setState({ create: createSpy } as never);
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: /add 529 plan/i }));
    const dialog = await screen.findByRole('dialog', { name: /add 529 plan/i });
    const typeSelect = within(dialog).getByLabelText(/^type$/i) as HTMLSelectElement;
    expect(typeSelect.value).toBe(AccountType.ACCOUNT_529);
    await user.type(within(dialog).getByLabelText(/^name$/i), "Junior's NY 529");
    await user.selectOptions(within(dialog).getByLabelText(/beneficiary/i), '1');
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));
    await vi.waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Junior's NY 529", type: AccountType.ACCOUNT_529 }),
    );
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('per-plan Edit opens a prefilled drawer; saving calls update (W14)', async () => {
    const updateSpy = vi.fn(async () => {});
    useAccountsStore.setState({
      accounts: [makeAccount({ id: 7, name: 'NY 529 for Junior', beneficiaryDependentId: 1, stateOfPlan: 'NY' })],
      update: updateSpy,
    } as never);
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: /edit ny 529 for junior/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit 529 plan/i });
    expect(within(dialog).getByLabelText(/^name$/i)).toHaveValue('NY 529 for Junior');
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));
    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'NY 529 for Junior' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('drawer delete confirms with the tab\'s exact copy (W14)', async () => {
    useAccountsStore.setState({
      accounts: [makeAccount({ id: 7, name: 'NY 529 for Junior' })],
    });
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole('button', { name: /edit ny 529 for junior/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit 529 plan/i });
    await user.click(within(dialog).getByRole('button', { name: /delete 529 plan/i }));
    expect(
      await screen.findByText(/monthly balance snapshots, holdings, and contribution history/i),
    ).toBeInTheDocument();
  });

  describe('Wave A: owner scoping + two-tier empty (D8 C29)', () => {
    function primeTwoPersons() {
      usePersonsStore.setState({
        persons: [
          { id: 1, householdId: 1, name: 'Alice' },
          { id: 2, householdId: 1, name: 'Bob' },
        ] as never,
        isLoading: false, error: null, load: async () => {},
      } as never);
    }

    function renderSectionAt(entry: string) {
      return render(
        <MemoryRouter initialEntries={[entry]}>
          <Plan529Section />
        </MemoryRouter>,
      );
    }

    it('D8/C29: 529 plans filter by account owner; hidden plans are declared', () => {
      primeTwoPersons();
      useAccountsStore.setState({
        accounts: [
          makeAccount({ id: 1, name: 'Alice 529', ownerPersonId: 1 }),
          makeAccount({ id: 2, name: 'Bob 529', ownerPersonId: 2 }),
          makeAccount({ id: 3, name: 'Joint 529', ownerPersonId: null }),
        ],
      });
      renderSectionAt('/goals?view=p1');
      expect(screen.getByText('Alice 529')).toBeInTheDocument();
      expect(screen.queryByText('Bob 529')).not.toBeInTheDocument();
      expect(screen.queryByText('Joint 529')).not.toBeInTheDocument();
      expect(screen.getByText('2 plans owned by Bob or joint not shown.')).toBeInTheDocument();
    });

    it('C29: filtered-empty 529 copy (never the false "No 529 plans yet.")', () => {
      primeTwoPersons();
      useAccountsStore.setState({
        accounts: [makeAccount({ id: 2, name: 'Bob 529', ownerPersonId: 2 })],
      });
      renderSectionAt('/goals?view=p1');
      expect(screen.queryByText('No 529 plans yet.')).not.toBeInTheDocument();
      expect(
        screen.getByText('No 529 plans owned by Alice — 1 household plan not shown.'),
      ).toBeInTheDocument();
    });

    it('true-empty keeps "No 529 plans yet." in a filtered view (regression)', () => {
      primeTwoPersons();
      useAccountsStore.setState({ accounts: [] });
      renderSectionAt('/goals?view=p1');
      expect(screen.getByText('No 529 plans yet.')).toBeInTheDocument();
      // The Add entry point stays mounted in every view (edit surface).
      expect(screen.getByRole('button', { name: 'Add 529 plan' })).toBeInTheDocument();
    });
  });
});
