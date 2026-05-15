import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useGoalsStore } from '@/stores/goals-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import {
  AccountType,
  ContributionSource,
  FilingStatus,
  GoalType,
  SnapshotSource,
} from '@/types/enums';
import type { Account, Contribution, Goal, GrowthScenario, Person } from '@/types/schema';
import Goals from '@/pages/Goals';

const basePerson: Person = {
  id: 1,
  householdId: 1,
  name: 'Alice',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
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
};

const fourScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
  { label: 'Bull', rate: 0.08 },
];

function resetStores() {
  useGoalsStore.setState({ goals: [], isLoading: false, error: null });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
}

interface PrimeOpts {
  scenarios?: GrowthScenario[];
  goals?: Array<Partial<Goal>>;
  accounts?: Array<Partial<Account>>;
  snapshotValues?: Array<{ accountId: number; snapshotDate: string; totalValue: number }>;
  /** Per-month $amount/account; defaults to one $1k contribution per month for last 6 months on accountId 1. */
  contributions?: Array<Partial<Contribution>>;
}

function primeStores(opts: PrimeOpts = {}) {
  // Override the load() functions on each store so the page's useEffect calls
  // are no-ops (it would otherwise try to hit a real database).
  useGoalsStore.setState({
    goals: (opts.goals ?? []).map((g, i) => ({
      id: g.id ?? i + 1,
      householdId: g.householdId ?? 1,
      forPersonId: g.forPersonId ?? null,
      name: g.name ?? `Goal ${i + 1}`,
      type: g.type ?? GoalType.GENERIC,
      targetAmount: g.targetAmount ?? 100_000,
      targetDate: g.targetDate ?? '2031-01-01',
      linkedAccountIds: g.linkedAccountIds ?? [],
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });

  useAccountsStore.setState({
    accounts: (opts.accounts ?? []).map((a, i) => ({
      id: a.id ?? i + 1,
      householdId: a.householdId ?? 1,
      ownerPersonId: a.ownerPersonId ?? null,
      beneficiaryDependentId: a.beneficiaryDependentId ?? null,
      name: a.name ?? `Account ${i + 1}`,
      institution: a.institution ?? null,
      type: a.type ?? AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: a.cryptoWalletAddress ?? null,
      autoFetchEnabled: a.autoFetchEnabled ?? false,
      excludedFromNetWorth: a.excludedFromNetWorth ?? false,
      stateOfPlan: a.stateOfPlan ?? null,
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });

  useSnapshotsStore.setState({
    snapshots: (opts.snapshotValues ?? []).map((s, i) => ({
      id: i + 1,
      accountId: s.accountId,
      snapshotDate: s.snapshotDate,
      totalValue: s.totalValue,
      source: SnapshotSource.MANUAL,
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });

  useContributionsStore.setState({
    contributions: (opts.contributions ?? []).map((c, i) => ({
      id: c.id ?? i + 1,
      accountId: c.accountId ?? 1,
      personId: c.personId ?? null,
      date: c.date ?? '2026-04-01',
      amount: c.amount ?? 0,
      source: c.source ?? ContributionSource.MANUAL,
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });

  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: opts.scenarios ?? fourScenarios,
    },
    isLoading: false,
    error: null,
  });
}

/** Build $amount contributions, one per month, for the last `months` months. */
function monthlyContribs(accountId: number, monthlyAmount: number, months = 6): Partial<Contribution>[] {
  const today = new Date();
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() - i);
    return {
      accountId,
      date: d.toISOString().slice(0, 10),
      amount: monthlyAmount,
    };
  });
}

describe('Goals page', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders empty state with link to /inputs/goals when no goals exist', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /^goals$/i })).toBeInTheDocument();
    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument();
    const addLink = screen.getByRole('link', { name: /add your first goal/i });
    expect(addLink).toHaveAttribute('href', '/inputs/goals');
  });

  it('renders one card per goal', () => {
    primeStores({
      goals: [
        { name: 'Emergency Fund', type: GoalType.EMERGENCY_FUND, targetAmount: 25_000, targetDate: '2031-01-01' },
        { name: 'House Down Payment', type: GoalType.DOWN_PAYMENT, targetAmount: 80_000, targetDate: '2032-06-01' },
        { name: 'Retirement', type: GoalType.RETIREMENT, targetAmount: 1_500_000, targetDate: '2055-01-01' },
      ],
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    expect(screen.getByText('Emergency Fund')).toBeInTheDocument();
    expect(screen.getByText('House Down Payment')).toBeInTheDocument();
    expect(screen.getByText('Retirement')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
  });

  it('shows on-track badge for an over-funded goal', () => {
    // currentSaved already exceeds target → onTrack regardless of contributions
    primeStores({
      goals: [
        {
          name: 'Already There',
          type: GoalType.EMERGENCY_FUND,
          targetAmount: 10_000,
          targetDate: '2030-01-01',
          linkedAccountIds: [1],
        },
      ],
      accounts: [{ id: 1, name: 'Savings' }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 12_000 }],
      contributions: monthlyContribs(1, 0, 6),
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    expect(screen.getByText(/^on track$/i)).toBeInTheDocument();
  });

  it('shows off-track badge for a goal that cannot meet the target', () => {
    // Tiny saved + tiny contributions, big target, near deadline → off-track
    primeStores({
      goals: [
        {
          name: 'Stretch Goal',
          type: GoalType.GENERIC,
          targetAmount: 1_000_000,
          targetDate: '2027-01-01',
          linkedAccountIds: [1],
        },
      ],
      accounts: [{ id: 1, name: 'Savings' }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 5_000 }],
      contributions: monthlyContribs(1, 100, 6),
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    expect(screen.getByText(/^off track$/i)).toBeInTheDocument();
  });

  it('progress bar aria-valuenow matches percentComplete rounded to nearest %', () => {
    // currentSaved=2_500, target=10_000 → percent=25%
    primeStores({
      goals: [
        {
          name: 'Quarter Way',
          type: GoalType.GENERIC,
          targetAmount: 10_000,
          targetDate: '2031-01-01',
          linkedAccountIds: [1],
        },
      ],
      accounts: [{ id: 1, name: 'Savings' }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 2_500 }],
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    const bar = screen.getByRole('progressbar', { name: /quarter way progress/i });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
  });

  it('derives currentSaved from latest snapshot per linked account (ignores older snapshots)', () => {
    primeStores({
      goals: [
        {
          name: 'Two Linked Accounts',
          type: GoalType.GENERIC,
          targetAmount: 1_000_000,
          targetDate: '2031-01-01',
          linkedAccountIds: [1, 2],
        },
      ],
      accounts: [
        { id: 1, name: 'Acct A' },
        { id: 2, name: 'Acct B' },
      ],
      snapshotValues: [
        // Older — must be ignored
        { accountId: 1, snapshotDate: '2025-01-01', totalValue: 999_999 },
        // Latest for acct 1
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 100_000 },
        // Older — must be ignored
        { accountId: 2, snapshotDate: '2025-06-01', totalValue: 999_999 },
        // Latest for acct 2
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 200_000 },
      ],
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    // 100k + 200k = 300k saved. Card should render the 300k figure.
    expect(screen.getByText(/\$300,000/)).toBeInTheDocument();
    // And NOT the spurious 999,999 from older snapshots
    expect(screen.queryByText(/\$999,999/)).not.toBeInTheDocument();
  });

  it('"Manage goals" link points to /inputs/goals when at least one goal exists', () => {
    primeStores({
      goals: [{ name: 'Emergency Fund' }],
    });
    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /manage goals/i });
    expect(link).toHaveAttribute('href', '/inputs/goals');
  });

  it('uses the Moderate scenario rate from household.growthScenarios for projection', () => {
    // The page surface should mention the rate it used (e.g. "6.0%")
    primeStores({
      scenarios: [
        { label: 'Conservative', rate: 0.04 },
        { label: 'Moderate', rate: 0.07 }, // intentionally not 0.06 so we know it picked Moderate
        { label: 'Aggressive', rate: 0.09 },
      ],
      goals: [{ name: 'Emergency Fund' }],
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    // Subtitle should reference 7.0% (Moderate rate by label)
    expect(screen.getByText(/7\.0%/)).toBeInTheDocument();
  });

  it('renders the goal type label next to the name', () => {
    primeStores({
      goals: [
        { name: 'Future Home', type: GoalType.DOWN_PAYMENT, targetAmount: 50_000, targetDate: '2030-01-01' },
      ],
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );
    // "Down payment" comes from GOAL_TYPE_LABELS
    expect(screen.getByText(/down payment/i)).toBeInTheDocument();
  });

  it('uses the 6-month average contribution to drive the projection (off- vs on-track flips with contributions)', () => {
    // Same goal, two store states. Without contributions → off-track. With
    // contributions → on-track. Confirms the page is averaging recent flow.
    const baseGoal = {
      name: 'Sensitive Goal',
      type: GoalType.GENERIC,
      targetAmount: 50_000,
      targetDate: '2031-01-01',
      linkedAccountIds: [1],
    };

    primeStores({
      goals: [baseGoal],
      accounts: [{ id: 1, name: 'Savings' }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 10_000 }],
      contributions: [],
    });

    const { unmount } = render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );

    // Confirm we got a card and an Off-track badge.
    const card1 = screen.getByText('Sensitive Goal').closest('[class*="rounded-xl"]');
    expect(card1).not.toBeNull();
    expect(within(card1 as HTMLElement).getByText(/off track/i)).toBeInTheDocument();
    unmount();

    // Now seed substantial monthly contributions; same fixture should flip on-track.
    primeStores({
      goals: [baseGoal],
      accounts: [{ id: 1, name: 'Savings' }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 10_000 }],
      contributions: monthlyContribs(1, 1_000, 6),
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );

    const card2 = screen.getByText('Sensitive Goal').closest('[class*="rounded-xl"]');
    expect(card2).not.toBeNull();
    expect(within(card2 as HTMLElement).getByText(/on track/i)).toBeInTheDocument();
  });

  it('view filter ?view=p1 hides p2 goals and keeps p1 goals visible', () => {
    // Seed two persons so useViewFilter recognises a two-person household.
    usePersonsStore.setState({
      persons: [
        { ...basePerson, id: 1, name: 'Alice' },
        { ...basePerson, id: 2, name: 'Bob' },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    primeStores({
      goals: [
        { name: "Alice's goal", forPersonId: 1 },
        { name: "Bob's goal", forPersonId: 2 },
        { name: 'Joint goal', forPersonId: null },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/goals?view=p1']}>
        <Goals />
      </MemoryRouter>,
    );

    // p1's goal is visible
    expect(screen.getByText("Alice's goal")).toBeInTheDocument();
    // p2's goal is filtered out
    expect(screen.queryByText("Bob's goal")).not.toBeInTheDocument();
    // The joint goal is filtered out too (only ?view=joint or household shows it)
    expect(screen.queryByText('Joint goal')).not.toBeInTheDocument();
  });
});
