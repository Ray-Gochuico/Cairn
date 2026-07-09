import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useGoalsStore } from '@/stores/goals-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSettingsStore } from '@/stores/settings-store';
import {
  AccountType,
  AssetClass,
  ContributionSource,
  FilingStatus,
  GoalType,
  SnapshotSource,
  TickerDirection,
} from '@/types/enums';
import type { Account, Contribution, Goal, GrowthScenario } from '@/types/schema';
import Dashboard from '@/pages/Dashboard';

const moderateScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
];

function resetStores() {
  useGoalsStore.setState({ goals: [], isLoading: false, error: null, load: async () => {} });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} });
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null, load: async () => {} });
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
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
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: async () => {} });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} });
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: async () => {} });
  useCategoriesStore.setState({ categories: [], isLoading: false, error: null, load: async () => {} });
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [], isLoading: false, error: null, load: async () => {},
  });
  // W10 S3/S4: the dashboard now gates on these too (holdings/tickers/fund-
  // holdings feed ConcentrationCard; roadmap-overrides feeds NextMoveCard).
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null, load: async () => {} } as never);
  useTickersStore.setState({ tickers: [], isLoading: false, error: null, load: async () => {} } as never);
  useFundHoldingsStore.setState({ fundHoldings: [], isLoading: false, error: null, load: async () => {} } as never);
  useRoadmapOverridesStore.setState({ overridesByNodeId: new Map(), isLoading: false, error: null, load: async () => {} } as never);
  // W13: settings joined the gate (briefing visit stamps). Null stamps →
  // 'Since <month>' fallback; noop update keeps the stamp effect off the DB.
  useSettingsStore.setState({
    settings: seededSettings(),
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
  } as never);
}

/** Minimal AppSettings slice the Dashboard/FreshnessBadge/briefing read. */
function seededSettings() {
  return {
    id: 1,
    lastRefreshAt: null,
    refreshCadence: 'EVERY_LAUNCH',
    lastSeenMonth: null,
    lastVisitDate: null,
    briefingBaselineDate: null,
  };
}

interface PrimeOpts {
  goals?: Array<Partial<Goal>>;
  accounts?: Array<Partial<Account>>;
  snapshotValues?: Array<{ accountId: number; snapshotDate: string; totalValue: number }>;
  contributions?: Array<Partial<Contribution>>;
}

function primeStores(opts: PrimeOpts = {}) {
  if (opts.goals) {
    useGoalsStore.setState({
      goals: opts.goals.map((g, i) => ({
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
  }

  if (opts.accounts) {
    useAccountsStore.setState({
      accounts: opts.accounts.map((a, i) => ({
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
        accentColor: a.accentColor ?? null,
      })),
      isLoading: false,
      error: null,
      load: async () => {},
    });
  }

  if (opts.snapshotValues) {
    useSnapshotsStore.setState({
      snapshots: opts.snapshotValues.map((s, i) => ({
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
  }

  if (opts.contributions) {
    useContributionsStore.setState({
      contributions: opts.contributions.map((c, i) => ({
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
  }
}

describe('Dashboard goals strip', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows empty state with "Add your first goal" link when no goals exist', () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument();
    const addLink = screen.getByRole('link', { name: /add your first goal/i });
    expect(addLink).toHaveAttribute('href', '/inputs/goals');
  });

  it('shows up to 3 goal mini-cards when goals exist', () => {
    primeStores({
      goals: [
        { name: 'Goal A', targetAmount: 10_000, targetDate: '2030-01-01' },
        { name: 'Goal B', targetAmount: 20_000, targetDate: '2030-01-01' },
        { name: 'Goal C', targetAmount: 30_000, targetDate: '2030-01-01' },
        { name: 'Goal D', targetAmount: 40_000, targetDate: '2030-01-01' },
        { name: 'Goal E', targetAmount: 50_000, targetDate: '2030-01-01' },
      ],
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.getByText('Goal A')).toBeInTheDocument();
    expect(screen.getByText('Goal B')).toBeInTheDocument();
    expect(screen.getByText('Goal C')).toBeInTheDocument();
    expect(screen.queryByText('Goal D')).not.toBeInTheDocument();
    expect(screen.queryByText('Goal E')).not.toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(3);
  });

  it('shows on-track styling for over-funded goal and off-track for stretch goal', () => {
    primeStores({
      goals: [
        {
          name: 'Already There',
          type: GoalType.EMERGENCY_FUND,
          targetAmount: 10_000,
          targetDate: '2030-01-01',
          linkedAccountIds: [1],
        },
        {
          name: 'Stretch Goal',
          type: GoalType.GENERIC,
          targetAmount: 1_000_000,
          targetDate: '2027-01-01',
          linkedAccountIds: [2],
        },
      ],
      accounts: [
        { id: 1, name: 'Savings A' },
        { id: 2, name: 'Savings B' },
      ],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 12_000 },
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 5_000 },
      ],
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    // The goals strip uses the same on-/off-track resolution as the Goals
    // page. Verify both badges render — over-funded gets "On track" and the
    // stretch goal with no contributions gets "Off track". Scoped to the
    // goals widget: the over-funded goal ALSO earns a W13 briefing row
    // ("You've reached your … goal."), so a page-wide name query is ambiguous.
    const goalsWidget = screen.getByTestId('widget-goals');
    const onTrackCard = within(goalsWidget).getByText('Already There').closest('[class*="rounded"]');
    expect(onTrackCard).not.toBeNull();
    expect(within(onTrackCard as HTMLElement).getByText(/on track/i)).toBeInTheDocument();

    const offTrackCard = within(goalsWidget).getByText('Stretch Goal').closest('[class*="rounded"]');
    expect(offTrackCard).not.toBeNull();
    expect(within(offTrackCard as HTMLElement).getByText(/off track/i)).toBeInTheDocument();
  });

  it('shows a "View all" link to the Goals page when at least one goal exists', () => {
    primeStores({
      goals: [{ name: 'Emergency Fund' }],
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /view all/i });
    expect(link).toHaveAttribute('href', '/goals');
  });
});

describe('Dashboard asset value chart widget', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the Asset value chart widget', async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    // The chart card's header value renders unconditionally (recharts'
    // ResponsiveContainer draws nothing in jsdom, but the header is plain
    // DOM), so this testid is a stable presence marker for the widget.
    const widget = screen.getByTestId('widget-asset-value-chart');
    expect(await screen.findByTestId('asset-chart-header-value')).toBeInTheDocument();
    // resetStores() seeds NO accounts/loans → zero eligible entities, so the
    // header shows the dashboard surface's default-scope label. The dashboard
    // surface defaults to assets-only (defaultIncludeLoans: false), hence
    // 'Total assets' — NOT 'Net worth', which is the no-loans/full-set label
    // when eligible entities exist.
    expect(within(widget).getByText('Total assets')).toBeInTheDocument();
  });
});

describe('Dashboard spending cards', () => {
  beforeEach(() => {
    resetStores();
  });

  it('spending pills + widget scope to ?view=p1 and pill hrefs keep the view (W10 F8/S1)', async () => {
    usePersonsStore.setState({
      persons: [
        { id: 1, name: 'Alex' } as never,
        { id: 2, name: 'Sam' } as never,
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);
    const makeTxn = (over: Record<string, unknown>) => ({
      id: 0, householdId: 1, date: '2026-05-10', merchant: 'M', merchantRaw: 'M',
      amount: 0, categoryId: null, sourceAccountId: null, propertyId: null, vehicleId: null,
      personId: null, sourcePdfFilename: null, reimbursable: false, reimbursedAt: null,
      reimbursedAmount: null, isRecurring: false, notes: null, ...over,
    });
    useTransactionsStore.setState({
      transactions: [
        makeTxn({ id: 1, personId: 1, amount: 40, reimbursable: true, reimbursedAt: null }),
        makeTxn({ id: 2, personId: 2, amount: 60, reimbursable: true, reimbursedAt: null }),
      ],
      isLoading: false, error: null, load: async () => {},
    } as never);
    render(
      <MemoryRouter initialEntries={['/?view=p1']}>
        <Dashboard />
      </MemoryRouter>,
    );
    // p1's $40 only — not the household $100.
    const pill = await screen.findByRole('link', { name: /awaiting reimbursement.*\$40/i });
    expect(pill).toHaveAttribute('href', '/spending?view=p1');
    expect(screen.queryByText('$100')).not.toBeInTheDocument();
  });

  it('shows Awaiting Reimbursement card with the pending total', () => {
    useTransactionsStore.setState({
      transactions: [
        {
          id: 1,
          householdId: 1,
          date: '2026-05-10',
          merchant: 'ACME CORP',
          merchantRaw: 'ACME CORP',
          amount: 250,
          categoryId: null,
          sourceAccountId: null,
          propertyId: null,
          vehicleId: null,
          personId: null,
          sourcePdfFilename: null,
          reimbursable: true,
          reimbursedAt: null,
          reimbursedAmount: null,
          isRecurring: false,
          notes: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.getByText(/awaiting reimbursement/i)).toBeInTheDocument();
    expect(screen.getByText('$250')).toBeInTheDocument();
  });

  it('shows Spending vs Budget card with current-month spend and over/under indication', () => {
    // Set budget to $3,000/month
    useHouseholdStore.setState({
      household: {
        filingStatus: FilingStatus.SINGLE,
        state: 'CA',
        city: null,
        monthlyExpenseBaseline: 3000,
        withdrawalRate: 0.04,
        inflationAssumption: 0.03,
        growthScenarios: moderateScenarios,
      },
      isLoading: false,
      error: null,
    });

    // A transaction in the current month (2026-05 = today's month per test context)
    const currentMonthDate = new Date().toISOString().slice(0, 7) + '-15';
    useTransactionsStore.setState({
      transactions: [
        {
          id: 2,
          householdId: 1,
          date: currentMonthDate,
          merchant: 'GROCERY STORE',
          merchantRaw: 'GROCERY STORE',
          amount: 500,
          categoryId: null,
          sourceAccountId: null,
          propertyId: null,
          vehicleId: null,
          personId: null,
          sourcePdfFilename: null,
          reimbursable: false,
          reimbursedAt: null,
          reimbursedAmount: null,
          isRecurring: false,
          notes: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.getByText(/spending vs budget/i)).toBeInTheDocument();
    // $500 spend, $3,000 budget → $2,500 under
    expect(screen.getByText(/\$2,500 under/i)).toBeInTheDocument();
  });
});

describe('Dashboard pills — excluded accounts', () => {
  beforeEach(() => {
    resetStores();
  });

  it('Net Worth and Liquid Investments pills drop excludedFromNetWorth accounts', () => {
    primeStores({
      accounts: [
        { id: 1, name: 'Brokerage', type: AccountType.ACCOUNT_BROKERAGE },
        {
          id: 2,
          name: 'Hidden brokerage',
          type: AccountType.ACCOUNT_BROKERAGE,
          excludedFromNetWorth: true,
        },
      ],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-30', totalValue: 100_000 },
        { accountId: 2, snapshotDate: '2026-04-30', totalValue: 50_000 },
      ],
    });
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    const cards = screen.getAllByTestId('metric-card');
    const netWorthCard = cards.find((c) => within(c).queryByText('Net Worth'))!;
    expect(within(netWorthCard).getByText('$100,000')).toBeInTheDocument();
    const liquidCard = cards.find((c) =>
      within(c).queryByText('Liquid Investments'),
    )!;
    expect(within(liquidCard).getByText('$100,000')).toBeInTheDocument();
  });
});

describe('net-worth MoM pill (Wave 2 §2)', () => {
  beforeEach(() => {
    resetStores();
  });

  const iso = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

  it('derives the delta from as-of history: two snapshots a month apart', () => {
    primeStores({
      accounts: [{ id: 1 }],
      snapshotValues: [
        { accountId: 1, snapshotDate: iso(45), totalValue: 10_000 },
        { accountId: 1, snapshotDate: iso(1), totalValue: 15_000 },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    // Scope to the Net Worth metric card — the AssetValueChart header shows
    // the same (deliberately converged) delta, so a page-wide query is
    // ambiguous.
    const cards = screen.getAllByTestId('metric-card');
    const netWorthCard = cards.find((c) => within(c).queryByText('Net Worth'))!;
    expect(within(netWorthCard).getByText('vs last month')).toBeInTheDocument();
    expect(within(netWorthCard).getByText(/\+\$5,000 \(\+50\.0%\)/)).toBeInTheDocument();
  });

  it('no account history: headline falls back to the estimate formula, no pill', () => {
    usePropertiesStore.setState({
      properties: [{
        id: 7, householdId: 1, ownerPersonId: null, name: 'Home', type: 'PRIMARY_RESIDENCE',
        address: null, purchaseDate: null, purchasePrice: null,
        currentEstimatedValue: 400_000, linkedLoanId: null, excludedFromNetWorth: false,
      } as never],
      isLoading: false, error: null, load: async () => {},
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const cards = screen.getAllByTestId('metric-card');
    const netWorthCard = cards.find((c) => within(c).queryByText('Net Worth'))!;
    expect(within(netWorthCard).getByText('$400,000')).toBeInTheDocument();
    // No account-snapshot history → factory null for both endpoints → NO pill
    // anywhere on the page (the honest state; the estimate formula only backs
    // the headline).
    expect(screen.queryByText('vs last month')).not.toBeInTheDocument();
  });

  it('suppresses the percent above the ±999.9% cap (near-zero baseline) — $ delta only', () => {
    // $12 → $15,000 is a ~124,900% "gain"; the chart header suppresses such
    // percents via deltaPctOrNull, and the pill must not print one either.
    primeStores({
      accounts: [{ id: 1 }],
      snapshotValues: [
        { accountId: 1, snapshotDate: iso(45), totalValue: 12 },
        { accountId: 1, snapshotDate: iso(1), totalValue: 15_000 },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const cards = screen.getAllByTestId('metric-card');
    const netWorthCard = cards.find((c) => within(c).queryByText('Net Worth'))!;
    expect(within(netWorthCard).getByText('vs last month')).toBeInTheDocument();
    // Exact match: if a percent were appended the delta text would read
    // '+$14,988 (+124900.0%)' and this query would fail.
    expect(within(netWorthCard).getByText('+$14,988')).toBeInTheDocument();
  });
});

describe('Dashboard load gate (W10 S3/S4, M3)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('loads roadmap overrides in reload() so NextMoveCard honors them (W10 M3)', () => {
    const load = vi.fn(async () => {});
    useRoadmapOverridesStore.setState({ overridesByNodeId: new Map(), isLoading: false, error: null, load } as never);
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(load).toHaveBeenCalled();
  });

  it('shows the loading skeleton, not $0 pills / Continue Setup, while stores load (W10 S3/S4)', () => {
    useHouseholdStore.setState({ household: null, isLoading: true, error: null, load: async () => {} } as never);
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
    expect(screen.queryByText(/continue setup/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('metric-card-value')).not.toBeInTheDocument();
  });
});

describe('W13 briefing hero', () => {
  beforeEach(() => {
    resetStores();
    // Pin "today" (Date only — real timers stay live for waitFor) so the
    // monthly-cadence grace window and month names are deterministic.
    // 2026-07-09 is day 9 → past the days-2..7 grace window.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-09T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderDashboard(initialEntries: string[] = ['/']) {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <Dashboard />
      </MemoryRouter>,
    );
  }

  it('renders the briefing card with a ranked net-worth row instead of the standalone NextMoveCard', async () => {
    // The house two-snapshot shape: a month-close snapshot and a recent one.
    // With no stored visit stamp the baseline is end-of-last-month (June 30).
    primeStores({
      accounts: [{ id: 1 }],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-06-30', totalValue: 207_000 },
        { accountId: 1, snapshotDate: '2026-07-08', totalValue: 225_000 },
      ],
    });
    renderDashboard();
    const briefing = await screen.findByTestId('briefing-card');
    expect(within(briefing).getByText(/net worth is (up|down)/i)).toBeInTheDocument();
    // No visit stamp → the honest month fallback heading.
    expect(within(briefing).getByText('Since June')).toBeInTheDocument();
    // The standalone card is gone; its phrase now only exists as a feed row.
    expect(screen.queryByText(/finish setting up to see your next move/i)).toBeNull();
  });

  it('the amber "Monthly input pending" banner is retired — the cadence ROW carries the ritual', () => {
    // Day 9 (past grace), one non-manual account with NO June snapshot →
    // pending, 1 balance to confirm.
    primeStores({ accounts: [{ id: 1 }] });
    renderDashboard();
    expect(screen.queryByText('Monthly input pending')).toBeNull();
    const briefing = screen.getByTestId('briefing-card');
    expect(within(briefing).getByText(/^Close \w+ — /)).toBeInTheDocument();
    expect(within(briefing).getByRole('link', { name: /close \w+/i })).toHaveAttribute(
      'href',
      '/monthly',
    );
  });

  it('stamps the visit once when last_visit_date is stale, and not on a same-day open', async () => {
    const update = vi.fn(async () => {});
    useSettingsStore.setState({
      settings: { ...seededSettings(), lastVisitDate: '2026-07-01', briefingBaselineDate: '2026-06-20' },
      isLoading: false, error: null, load: async () => {}, update,
    } as never);
    renderDashboard();
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ briefingBaselineDate: '2026-07-01' }),
      ),
    );
    expect(update).toHaveBeenCalledTimes(1);

    // Same-day open: the stamps are already today's — nothing rolls.
    const update2 = vi.fn(async () => {});
    useSettingsStore.setState({
      settings: { ...seededSettings(), lastVisitDate: '2026-07-09', briefingBaselineDate: '2026-07-06' },
      isLoading: false, error: null, load: async () => {}, update: update2,
    } as never);
    renderDashboard();
    expect(screen.getAllByTestId('briefing-card').length).toBeGreaterThan(0);
    expect(update2).not.toHaveBeenCalled();
  });

  it('empty-state honesty: neither rows nor "Nothing needs your attention" render while stores load', () => {
    useHouseholdStore.setState({ household: null, isLoading: true, error: null, load: async () => {} } as never);
    renderDashboard();
    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
    expect(screen.queryByTestId('briefing-card')).toBeNull();
    expect(screen.queryByText(/nothing needs your attention/i)).toBeNull();
  });

  it('?view=p1: household-scoped rows carry the "· Household" suffix (concentration)', () => {
    usePersonsStore.setState({
      persons: [
        { id: 1, name: 'Alex' } as never,
        { id: 2, name: 'Sam' } as never,
      ],
      isLoading: false, error: null, load: async () => {},
    } as never);
    // >15% top exposure: BND at 80 of 100 shares of a $100k account (the
    // ConcentrationCard seed pattern).
    primeStores({
      accounts: [{ id: 1 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-06-30', totalValue: 100_000 }],
    });
    useHoldingsStore.setState({
      holdings: [
        { id: 1, accountId: 1, ticker: 'BND', shareCount: 80, targetAllocationPct: null, costBasis: null },
        { id: 2, accountId: 1, ticker: 'VTI', shareCount: 20, targetAllocationPct: null, costBasis: null },
      ],
      isLoading: false, error: null, load: async () => {},
    } as never);
    const mkTicker = (ticker: string, assetClass: AssetClass) =>
      ({ ticker, name: null, assetClass, leverageFactor: 1, direction: TickerDirection.LONG, userAdded: false, accentColor: null, sector: null, industry: null });
    useTickersStore.setState({
      tickers: [mkTicker('BND', AssetClass.US_BONDS), mkTicker('VTI', AssetClass.US_TOTAL_MARKET)],
      isLoading: false, error: null, load: async () => {},
      upsert: async () => {}, remove: async () => {}, lookup: () => undefined,
    } as never);
    renderDashboard(['/?view=p1']);
    const row = screen.getByTestId('briefing-row-concentration');
    expect(row).toHaveTextContent('· Household');
  });
});
