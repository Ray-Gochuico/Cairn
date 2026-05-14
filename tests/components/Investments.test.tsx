import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import {
  AccountType,
  ContributionSource,
  DependentType,
  FilingStatus,
  SnapshotSource,
} from '@/types/enums';
import type { Account, Contribution, Dependent, GrowthScenario } from '@/types/schema';
import Investments from '@/pages/Investments';

// The page reads asset_class for each ticker via getDatabase().select(...).
// We don't have a SQLite singleton here and we don't care about the tickers
// table for the 529 section, so the easiest path is to stub getDatabase().
vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    // The page only calls select() when there's at least one holding; we
    // resolve to an empty array so any unexpected call is a no-op.
    select: async () => [],
  }),
}));

const fourScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
  { label: 'Bull', rate: 0.08 },
];

function resetStores() {
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
}

interface PrimeOpts {
  scenarios?: GrowthScenario[];
  accounts?: Array<Partial<Account>>;
  /** Snapshot rows; auto-IDs and source default to MANUAL. */
  snapshotValues?: Array<{ accountId: number; snapshotDate: string; totalValue: number }>;
  contributions?: Array<Partial<Contribution>>;
  dependents?: Array<Partial<Dependent>>;
}

function primeStores(opts: PrimeOpts = {}) {
  // Override load() on every store so the page's mount-time refresh is a
  // no-op (no DB calls). Mirrors the pattern used in Goals.test.tsx.
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

  useHoldingsStore.setState({
    holdings: [],
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

  useDependentsStore.setState({
    dependents: (opts.dependents ?? []).map((d, i) => ({
      id: d.id ?? i + 1,
      householdId: d.householdId ?? 1,
      name: d.name ?? `Dependent ${i + 1}`,
      dateOfBirth: d.dateOfBirth ?? '2018-01-01',
      type: d.type ?? DependentType.CHILD,
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
    load: async () => {},
  });
}

describe('Investments page — 529 section', () => {
  beforeEach(() => {
    resetStores();
  });

  it('does NOT render 529 Plans section when no 529 accounts exist', () => {
    primeStores({
      accounts: [
        { id: 1, name: 'Schwab Brokerage', type: AccountType.ACCOUNT_BROKERAGE },
      ],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 50_000 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    // The 529 testid sentinel must not be in the DOM at all.
    expect(screen.queryByTestId('529-section')).not.toBeInTheDocument();
    // And the heading text should not appear either.
    expect(screen.queryByText(/^529 Plans$/)).not.toBeInTheDocument();
  });

  it('renders 529 Plans section with current value when a 529 account has a snapshot', () => {
    primeStores({
      accounts: [
        {
          id: 10,
          name: "Junior's NY 529",
          type: AccountType.ACCOUNT_529,
          stateOfPlan: 'NY',
        },
      ],
      snapshotValues: [
        { accountId: 10, snapshotDate: '2026-04-01', totalValue: 12_345 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    const section = screen.getByTestId('529-section');
    expect(section).toBeInTheDocument();
    expect(within(section).getByText("Junior's NY 529")).toBeInTheDocument();
    // Current value formatted as USD with no decimals.
    expect(within(section).getByText(/\$12,345/)).toBeInTheDocument();
    // The "now" label sits next to the value.
    expect(within(section).getByText(/^now$/)).toBeInTheDocument();
    // State of plan surfaces in the muted subtitle (· NY).
    expect(within(section).getByText(/· NY/)).toBeInTheDocument();
  });

  it('shows beneficiary name when beneficiaryDependentId is set, and "no beneficiary set" otherwise', () => {
    primeStores({
      dependents: [{ id: 1, name: 'Junior', dateOfBirth: '2018-05-15' }],
      accounts: [
        {
          id: 10,
          name: 'With Beneficiary',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: 1,
        },
        {
          id: 11,
          name: 'Without Beneficiary',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: null,
        },
      ],
      snapshotValues: [
        { accountId: 10, snapshotDate: '2026-04-01', totalValue: 5_000 },
        { accountId: 11, snapshotDate: '2026-04-01', totalValue: 1_000 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    const section = screen.getByTestId('529-section');
    expect(within(section).getByText(/for Junior/)).toBeInTheDocument();
    expect(within(section).getByText(/no beneficiary set/)).toBeInTheDocument();
  });

  it('shows YTD contributions summed for the current calendar year', () => {
    const year = new Date().getFullYear();
    primeStores({
      dependents: [{ id: 1, name: 'Junior', dateOfBirth: '2018-05-15' }],
      accounts: [
        {
          id: 10,
          name: '529 Plan',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: 1,
        },
      ],
      snapshotValues: [
        { accountId: 10, snapshotDate: `${year}-01-01`, totalValue: 10_000 },
      ],
      contributions: [
        // Two YTD contributions = $750 total.
        { accountId: 10, date: `${year}-01-15`, amount: 250 },
        { accountId: 10, date: `${year}-02-15`, amount: 500 },
        // Prior year — must NOT be counted.
        { accountId: 10, date: `${year - 1}-12-31`, amount: 9999 },
        // Different account — must NOT be counted.
        { accountId: 99, date: `${year}-03-15`, amount: 1234 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    const section = screen.getByTestId('529-section');
    expect(within(section).getByText(/\$750/)).toBeInTheDocument();
    // The "YTD" label sits next to the YTD value.
    expect(within(section).getByText(/^YTD$/)).toBeInTheDocument();
    // The prior-year contribution must not surface as a value.
    expect(within(section).queryByText(/\$9,999/)).not.toBeInTheDocument();
    // The other-account contribution must not surface either.
    expect(within(section).queryByText(/\$1,234/)).not.toBeInTheDocument();
  });

  it('shows projected-at-18 row when beneficiary has DOB, omits it when no beneficiary', () => {
    // Junior's DOB is 17 years before today → ~12 months until 18.
    const today = new Date();
    const dob = new Date(today);
    dob.setFullYear(today.getFullYear() - 17);
    const dobIso = dob.toISOString().slice(0, 10);

    primeStores({
      dependents: [{ id: 1, name: 'Junior', dateOfBirth: dobIso }],
      accounts: [
        {
          id: 10,
          name: 'Has Beneficiary',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: 1,
        },
        {
          id: 11,
          name: 'No Beneficiary',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: null,
        },
      ],
      snapshotValues: [
        { accountId: 10, snapshotDate: '2026-04-01', totalValue: 25_000 },
        { accountId: 11, snapshotDate: '2026-04-01', totalValue: 3_000 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    const section = screen.getByTestId('529-section');
    // The "at 18" label appears for the beneficiaried plan only — so exactly
    // one occurrence in the section.
    expect(within(section).getAllByText(/^at 18$/)).toHaveLength(1);
    // Subtitle should mention the Moderate scenario rate (default 6.0%).
    expect(within(section).getByText(/6\.0%/)).toBeInTheDocument();
  });
});
