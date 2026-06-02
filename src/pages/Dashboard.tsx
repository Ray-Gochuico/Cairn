import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckIcon,
  CreditCard,
  GraduationCap,
  Home,
  LifeBuoy,
  Palmtree,
  PencilIcon,
  PlusIcon,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { useHouseholdStore } from '@/stores/household-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useGoalsStore } from '@/stores/goals-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { AccountType, GoalType } from '@/types/enums';
import { netWorthForMonth, type NetWorthInput } from '@/lib/networth';
import { summarizeSpending } from '@/lib/spending-analysis';
import { isMonthlyInputPending, lastMonthYyyymm } from '@/lib/input-pending';
import { computeGoalProgress, type GoalProgressResult } from '@/lib/goal-progress';
import {
  filterByForPersonId,
  filterByObligorPersonId,
  filterByOwnerPersonId,
} from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import { formatPercent } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';
import MetricCard from '@/components/cards/MetricCard';
import { ConcentrationCard } from '@/components/cards/ConcentrationCard';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import { NextMoveCard } from '@/components/dashboard/NextMoveCard';
import { TodaysTriviaCard } from '@/components/dashboard/TodaysTriviaCard';
import { EditablePill } from '@/components/dashboard/EditablePill';
import { EditableWidget } from '@/components/dashboard/EditableWidget';
import { usePillLayout } from '@/components/dashboard/use-pill-layout';
import { useWidgetLayout } from '@/components/dashboard/use-widget-layout';
import { SpendingWidget } from '@/components/dashboard/SpendingWidget';
import type {
  Account,
  AccountSnapshot,
  Contribution,
  Goal,
  Household,
} from '@/types/schema';

/**
 * Dashboard v1 — Phase 2 entry surface.
 *
 * Composition: pulls every store needed for the four headline metrics, then
 * computes them inline rather than dragging in a shared hook. NetWorth lives
 * in its own page (with MoM/YoY math); here we just need the current-month
 * value, so we re-call `netWorthForMonth` directly off the store data.
 *
 * "Liquid Investments" deliberately excludes tax-advantaged retirement
 * accounts (401k/IRA/529) and crypto, plus all illiquid assets (property,
 * vehicles). The four eligible types are BROKERAGE, CASH, SAVINGS, HSA — HSA
 * counts because it can be withdrawn for qualified medical use without
 * penalty even pre-retirement. Each account contributes the latest snapshot
 * value at or before the current month; accounts with no snapshot
 * contribute 0.
 *
 * "Monthly Cash Flow" is a Phase 4 metric (needs transactions); we render an
 * em-dash with a hint so the slot exists but the user knows it's pending.
 */

const LIQUID_INVESTMENT_TYPES = new Set<AccountType>([
  AccountType.ACCOUNT_BROKERAGE,
  AccountType.ACCOUNT_CASH,
  AccountType.ACCOUNT_SAVINGS,
  AccountType.ACCOUNT_HSA,
]);

/**
 * Account types whose values are entered manually as of "today", not
 * auto-derived from ticker prices. Matches `SKIPPED_ACCOUNT_TYPES` in
 * `daily-snapshot.ts` so the pending-input nudge stays consistent with
 * what today's snapshot derivation actually produces.
 */
const MANUAL_BALANCE_TYPES = new Set<AccountType>([
  AccountType.ACCOUNT_CASH,
  AccountType.ACCOUNT_SAVINGS,
  AccountType.ACCOUNT_CRYPTO,
]);

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const signedCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
  signDisplay: 'always',
});

function formatUSD(value: number): string {
  return currencyFormatter.format(value);
}

function formatSignedUSD(value: number): string {
  return signedCurrencyFormatter.format(value);
}

function formatPercentDelta(current: number, baseline: number): string {
  if (baseline === 0) return '';
  const pct = ((current - baseline) / Math.abs(baseline)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return ` (${sign}${pct.toFixed(1)}%)`;
}

function currentYyyymm(): string {
  return new Date().toISOString().slice(0, 7);
}

function priorYyyymm(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return prev.toISOString().slice(0, 7);
}

/**
 * Goals strip: lucide-icon per GoalType, mirrors the icon set on the
 * Goals page (must stay in sync — kept inline rather than shared to
 * keep this dashboard widget independent of Goals.tsx's module
 * structure). Wave-3 Design must-have #5 — emoji vocabulary moved to
 * lucide so the type system can lint the mapping and dark-mode
 * doesn't see emoji-vs-text-color drift.
 */
const GOAL_TYPE_ICONS: Record<GoalType, LucideIcon> = {
  [GoalType.RETIREMENT]: Palmtree,
  [GoalType.DOWN_PAYMENT]: Home,
  [GoalType.DEBT_PAYOFF]: CreditCard,
  [GoalType.EDUCATION]: GraduationCap,
  [GoalType.EMERGENCY_FUND]: LifeBuoy,
  [GoalType.GENERIC]: Target,
};

/**
 * Pick the moderate growth rate for goal projections. Mirrors Goals.tsx /
 * FinancialIndependenceCard so all surfaces agree on which scenario drives projections.
 * Falls back to 6% when household has no scenarios.
 */
function pickModerateRate(household: Household | null): number {
  const FALLBACK = 0.06;
  if (!household || household.growthScenarios.length === 0) return FALLBACK;
  const moderate = household.growthScenarios.find((s) => s.label === 'Moderate');
  if (moderate) return moderate.rate;
  const second = household.growthScenarios[1];
  if (second) return second.rate;
  return household.growthScenarios[0]?.rate ?? FALLBACK;
}

/**
 * Build a map of accountId → latest snapshot total. ISO date strings sort
 * lexicographically, so a string compare picks the chronologically latest.
 */
function latestSnapshotPerAccount(snapshots: AccountSnapshot[]): Map<number, number> {
  const winner = new Map<number, { date: string; value: number }>();
  for (const s of snapshots) {
    const prev = winner.get(s.accountId);
    if (!prev || s.snapshotDate > prev.date) {
      winner.set(s.accountId, { date: s.snapshotDate, value: s.totalValue });
    }
  }
  return new Map([...winner.entries()].map(([k, v]) => [k, v.value]));
}

/**
 * 6-month rolling average contribution to a set of accounts. Mirrors
 * Goals.tsx — months with zero contributions still divide the total down.
 */
function monthlyContributionAvg(
  contributions: Contribution[],
  linkedIds: number[],
  today: Date,
  monthsBack = 6,
): number {
  if (linkedIds.length === 0 || monthsBack <= 0) return 0;
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const linkedSet = new Set(linkedIds);
  const total = contributions
    .filter((c) => linkedSet.has(c.accountId) && c.date >= cutoffIso)
    .reduce((sum, c) => sum + c.amount, 0);
  return total / monthsBack;
}

interface GoalProjection extends GoalProgressResult {
  goal: Goal;
}

/**
 * Compact, single-row goal preview for the dashboard. One line of identity
 * (icon + name + percent), one slim progress bar coloured by on-track state.
 * The richer fields (monthly needed, projected at target) live on the full
 * Goals page — this is just an at-a-glance affordance.
 */
function MiniGoalCard({ projection }: { projection: GoalProjection }) {
  const { goal } = projection;
  const pct = Math.min(1, Math.max(0, projection.percentComplete));
  const valuenow = Math.round(pct * 100);
  const onTrack = projection.onTrack;
  return (
    <Link
      to="/goals"
      className="block rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {(() => {
            // Resolve at render time; the lookup is O(1) and the IIFE keeps
            // the lucide component reference scoped to this JSX block.
            const Icon = GOAL_TYPE_ICONS[goal.type] ?? Target;
            return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
          })()}
          <span className="text-sm font-medium truncate">{goal.name}</span>
        </div>
        <span
          className={
            onTrack
              ? 'text-xs px-1.5 py-0.5 rounded bg-success-soft text-success-foreground whitespace-nowrap'
              : 'text-xs px-1.5 py-0.5 rounded bg-warning-soft text-warning-foreground whitespace-nowrap'
          }
        >
          {onTrack ? 'On track' : 'Off track'}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={valuenow}
        aria-label={`${goal.name} progress`}
      >
        <div
          className={onTrack ? 'h-full bg-success' : 'h-full bg-warning'}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground mt-1 tabular-nums">
        {formatPercent(projection.percentComplete)} complete
      </div>
    </Link>
  );
}

/**
 * Sum the latest snapshot total per account whose type is in
 * LIQUID_INVESTMENT_TYPES, scoped to snapshots at or before the current
 * month. Accounts excluded from net worth are still counted here — the
 * "excluded" flag is about net-worth tallying, not liquidity classification.
 */
function computeLiquidInvestments(
  accounts: Account[],
  snapshots: AccountSnapshot[],
  asOfMonth: string,
): number {
  const liquidAccountIds = new Set(
    accounts
      .filter((a) => LIQUID_INVESTMENT_TYPES.has(a.type) && a.id !== undefined)
      .map((a) => a.id as number),
  );
  if (liquidAccountIds.size === 0) return 0;

  const latestByAccount = new Map<number, AccountSnapshot>();
  for (const s of snapshots) {
    if (!liquidAccountIds.has(s.accountId)) continue;
    if (s.snapshotDate.slice(0, 7) > asOfMonth) continue;
    const existing = latestByAccount.get(s.accountId);
    if (!existing || existing.snapshotDate < s.snapshotDate) {
      latestByAccount.set(s.accountId, s);
    }
  }
  return [...latestByAccount.values()].reduce((sum, s) => sum + s.totalValue, 0);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { filter, persons } = useViewFilter();

  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);
  const householdError = useHouseholdStore((s) => s.error);

  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const accountsError = useAccountsStore((s) => s.error);

  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);
  const loansError = useLoansStore((s) => s.error);

  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const snapshotsError = useSnapshotsStore((s) => s.error);

  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const propertiesError = usePropertiesStore((s) => s.error);

  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const vehiclesError = useVehiclesStore((s) => s.error);

  const goals = useGoalsStore((s) => s.goals);
  const loadGoals = useGoalsStore((s) => s.load);
  const goalsError = useGoalsStore((s) => s.error);

  const contributions = useContributionsStore((s) => s.contributions);
  const loadContributions = useContributionsStore((s) => s.load);
  const contributionsError = useContributionsStore((s) => s.error);

  // Holdings + tickers + fund-holdings feed the ConcentrationCard via
  // useConcentration(). Loaded here so the card renders against populated
  // data on first paint instead of an empty "0 warnings" flash.
  const loadHoldings = useHoldingsStore((s) => s.load);
  const holdingsError = useHoldingsStore((s) => s.error);
  const loadTickers = useTickersStore((s) => s.load);
  const tickersError = useTickersStore((s) => s.error);
  const loadFundHoldings = useFundHoldingsStore((s) => s.load);
  const fundHoldingsError = useFundHoldingsStore((s) => s.error);

  const transactions = useTransactionsStore((s) => s.transactions);
  const loadTransactions = useTransactionsStore((s) => s.load);
  const transactionsError = useTransactionsStore((s) => s.error);

  const categories = useCategoriesStore((s) => s.categories);
  const loadCategories = useCategoriesStore((s) => s.load);
  const categoriesError = useCategoriesStore((s) => s.error);

  // `reload` doubles as the Retry handler for the store-error banner.
  const reload = useCallback(() => {
    loadHousehold();
    loadAccounts();
    loadLoans();
    loadSnapshots();
    loadProperties();
    loadVehicles();
    loadGoals();
    loadContributions();
    loadHoldings();
    loadTickers();
    loadFundHoldings();
    loadTransactions();
    loadCategories();
  }, [
    loadHousehold,
    loadAccounts,
    loadLoans,
    loadSnapshots,
    loadProperties,
    loadVehicles,
    loadGoals,
    loadContributions,
    loadHoldings,
    loadTickers,
    loadFundHoldings,
    loadTransactions,
    loadCategories,
  ]);
  useEffect(() => {
    reload();
  }, [reload]);

  // Errors from the core data stores the dashboard reads. Surfaced as a banner
  // above the widgets so a load failure reads as a recoverable hiccup, not as
  // vanished data. (Holdings/tickers/fund-holdings feed the ConcentrationCard;
  // their `error` is included so a concentration-data load failure is legible
  // too — we only read the error string here, never the concentration logic.)
  const storeErrors = [
    householdError,
    accountsError,
    loansError,
    snapshotsError,
    propertiesError,
    vehiclesError,
    goalsError,
    contributionsError,
    holdingsError,
    tickersError,
    fundHoldingsError,
    transactionsError,
    categoriesError,
  ];

  const today = useMemo(() => new Date(), []);
  const currentMonth = useMemo(() => currentYyyymm(), []);
  const previousMonth = useMemo(() => priorYyyymm(currentMonth), [currentMonth]);

  // Apply the view filter to every entity rendered in the headline metrics
  // and the goals strip. ConcentrationCard intentionally stays household-wide
  // (see the comment above its render below).
  const visibleAccounts = useMemo(
    () => filterByOwnerPersonId(accounts, filter, persons),
    [accounts, filter, persons],
  );
  const visibleAccountIds = useMemo(
    () => new Set(visibleAccounts.map((a) => a.id).filter((id): id is number => id != null)),
    [visibleAccounts],
  );
  const visibleSnapshots = useMemo(
    () => (filter === 'household'
      ? snapshots
      : snapshots.filter((s) => visibleAccountIds.has(s.accountId))),
    [snapshots, filter, visibleAccountIds],
  );
  const visibleProperties = useMemo(
    () => filterByOwnerPersonId(properties, filter, persons),
    [properties, filter, persons],
  );
  const visibleVehicles = useMemo(
    () => filterByOwnerPersonId(vehicles, filter, persons),
    [vehicles, filter, persons],
  );
  const visibleLoans = useMemo(
    () => filterByObligorPersonId(loans, filter, persons),
    [loans, filter, persons],
  );
  const visibleGoals = useMemo(
    () => filterByForPersonId(goals, filter, persons),
    [goals, filter, persons],
  );

  const netWorthInput = useMemo<NetWorthInput>(() => ({
    snapshots: visibleSnapshots.map((s) => ({
      accountId: s.accountId,
      snapshotMonth: s.snapshotDate.slice(0, 7),
      totalValue: s.totalValue,
    })),
    properties: visibleProperties.map((p) => ({
      id: p.id!,
      currentEstimatedValue: p.currentEstimatedValue,
      excludedFromNetWorth: p.excludedFromNetWorth,
    })),
    vehicles: visibleVehicles.map((v) => ({
      id: v.id!,
      currentEstimatedValue: v.currentEstimatedValue,
      excludedFromNetWorth: v.excludedFromNetWorth,
    })),
    loans: visibleLoans.map((l) => ({ id: l.id!, currentBalance: l.currentBalance })),
  }), [visibleSnapshots, visibleProperties, visibleVehicles, visibleLoans]);

  const currentNetWorth = useMemo(
    () => netWorthForMonth(currentMonth, netWorthInput),
    [currentMonth, netWorthInput],
  );

  const previousNetWorth = useMemo(
    () => netWorthForMonth(previousMonth, netWorthInput),
    [previousMonth, netWorthInput],
  );

  const totalDebt = useMemo(
    () => visibleLoans.reduce((sum, l) => sum + l.currentBalance, 0),
    [visibleLoans],
  );

  const liquidInvestments = useMemo(
    () => computeLiquidInvestments(visibleAccounts, visibleSnapshots, currentMonth),
    [visibleAccounts, visibleSnapshots, currentMonth],
  );

  /**
   * Compute on-track / off-track projections per goal using the same machinery
   * as the Goals page. Renders only the first 3 in the strip; the rest live
   * behind the "View all" link. We resolve currentSaved + recent contribution
   * average per goal (mirrors Goals.tsx) so the dashboard agrees with the
   * detail page.
   */
  const annualGrowthRate = useMemo(() => pickModerateRate(household), [household]);

  const goalProjections = useMemo<GoalProjection[]>(() => {
    if (visibleGoals.length === 0) return [];
    // currentSaved/contributions still derive from the full snapshots and
    // contributions stores — a goal's `linkedAccountIds` already constrains
    // which accounts feed the projection, so there's no need to re-filter
    // here.
    const latestMap = latestSnapshotPerAccount(snapshots);
    return visibleGoals.map((g) => {
      const currentSaved = g.linkedAccountIds.reduce(
        (sum, id) => sum + (latestMap.get(id) ?? 0),
        0,
      );
      const recentMonthlyContribution = monthlyContributionAvg(
        contributions,
        g.linkedAccountIds,
        today,
        6,
      );
      const result = computeGoalProgress({
        targetAmount: g.targetAmount,
        targetDate: g.targetDate,
        currentSaved,
        recentMonthlyContribution,
        annualGrowthRate,
        today,
      });
      return { goal: g, ...result };
    });
  }, [visibleGoals, snapshots, contributions, today, annualGrowthRate]);

  /**
   * Pending-input detection lives in `src/lib/input-pending.ts` as a pure
   * helper. Dashboard's job is to compose the inputs:
   *   - `accountIds`: every non-excluded account whose value is auto-derived
   *     (the manual-balance set is skipped — those get a "what's today's
   *     balance?" card in the mini-window instead of a last-month check).
   *   - `snapshotsLastMonth`: filtered to last month's snapshots.
   */
  const pendingAccountIds = useMemo(
    () =>
      visibleAccounts
        .filter(
          (a) =>
            a.id !== undefined &&
            !a.excludedFromNetWorth &&
            !MANUAL_BALANCE_TYPES.has(a.type),
        )
        .map((a) => a.id as number),
    [visibleAccounts],
  );

  const lastMonth = useMemo(() => lastMonthYyyymm(today), [today]);

  const snapshotsLastMonth = useMemo(
    () => visibleSnapshots.filter((s) => s.snapshotDate.slice(0, 7) === lastMonth),
    [visibleSnapshots, lastMonth],
  );

  const isInputPending = useMemo(
    () =>
      isMonthlyInputPending(today, {
        accountIds: pendingAccountIds,
        snapshotsLastMonth,
      }),
    [today, pendingAccountIds, snapshotsLastMonth],
  );

  // Spending cards: awaiting reimbursement + spending vs budget
  const awaitingReimbursementTotal = useMemo(
    () => transactions
      .filter((t) => t.reimbursable && t.reimbursedAt == null)
      .reduce((s, t) => s + t.amount, 0),
    [transactions],
  );

  const spendingSummary = useMemo(
    () => summarizeSpending(transactions, categories),
    [transactions, categories],
  );
  const currentMonthSpend = spendingSummary.currentMonthTotal;
  const monthlyBudget = household?.monthlyExpenseBaseline ?? 0;

  const netWorthDelta = currentNetWorth - previousNetWorth;
  const hasNetWorthBaseline = previousNetWorth !== 0;
  const netWorthDeltaLabel = hasNetWorthBaseline
    ? `${formatSignedUSD(netWorthDelta)}${formatPercentDelta(currentNetWorth, previousNetWorth)}`
    : undefined;
  const netWorthDeltaTone = !hasNetWorthBaseline
    ? 'neutral'
    : netWorthDelta >= 0
      ? 'positive'
      : 'negative';

  const todayLabel = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // Build the per-pill descriptors that the layout hook orders + filters.
  // Putting each pill's props on a single object keeps the render loop a
  // straightforward map without losing strong typing on the MetricCardProps.
  type PillId =
    | 'net-worth'
    | 'total-debt'
    | 'liquid-investments'
    | 'awaiting-reimbursement'
    | 'spending-vs-budget';

  const pillDefs: Array<{ id: PillId; label: string; render: () => ReactElement }> = [
    {
      id: 'net-worth',
      label: 'Net Worth',
      render: () => (
        <MetricCard
          label="Net Worth"
          value={formatUSD(currentNetWorth)}
          href="/net-worth"
          delta={netWorthDeltaLabel}
          deltaTone={netWorthDeltaTone}
          subtitle={hasNetWorthBaseline ? 'vs last month' : undefined}
        />
      ),
    },
    {
      id: 'total-debt',
      label: 'Total Debt',
      render: () => (
        <MetricCard
          label="Total Debt"
          value={formatUSD(totalDebt)}
          href="/loans"
          subtitle={visibleLoans.length > 0
            ? `Across ${visibleLoans.length} loan${visibleLoans.length === 1 ? '' : 's'}`
            : undefined}
        />
      ),
    },
    {
      id: 'liquid-investments',
      label: 'Liquid Investments',
      render: () => (
        <MetricCard
          label="Liquid Investments"
          value={formatUSD(liquidInvestments)}
          href="/investments"
          subtitle="Brokerage, cash, savings, HSA"
        />
      ),
    },
    {
      id: 'awaiting-reimbursement',
      label: 'Awaiting Reimbursement',
      render: () => (
        <MetricCard
          label="Awaiting Reimbursement"
          value={formatUSD(awaitingReimbursementTotal)}
          href="/spending"
          subtitle={awaitingReimbursementTotal > 0 ? 'Click to review' : 'None pending'}
        />
      ),
    },
    {
      id: 'spending-vs-budget',
      label: 'Spending vs Budget',
      render: () => (
        <MetricCard
          label="Spending vs Budget"
          value={formatUSD(currentMonthSpend)}
          href="/spending"
          delta={monthlyBudget > 0
            ? currentMonthSpend > monthlyBudget
              ? `${formatUSD(currentMonthSpend - monthlyBudget)} over`
              : `${formatUSD(monthlyBudget - currentMonthSpend)} under`
            : undefined}
          deltaTone={monthlyBudget > 0
            ? currentMonthSpend > monthlyBudget
              ? 'negative'
              : 'positive'
            : 'neutral'}
          subtitle={monthlyBudget > 0
            ? `Budget: ${formatUSD(monthlyBudget)}`
            : 'Set a budget in Inputs'}
        />
      ),
    },
  ];
  const pillIds = useMemo<readonly PillId[]>(
    () => ['net-worth', 'total-debt', 'liquid-investments', 'awaiting-reimbursement', 'spending-vs-budget'],
    [],
  );
  const pillLayout = usePillLayout(pillIds);
  const pillById = new Map(pillDefs.map((p) => [p.id, p]));
  const [editing, setEditing] = useState(false);

  const orderedPills = pillLayout.layout
    .map((e) => ({ entry: e, def: pillById.get(e.id as PillId) }))
    .filter((row): row is { entry: typeof pillLayout.layout[number]; def: (typeof pillDefs)[number] } => row.def !== undefined);
  const visiblePills = orderedPills.filter((p) => !p.entry.hidden);
  const hiddenPills = orderedPills.filter((p) => p.entry.hidden);

  // Widget layout (whole-row blocks the user can re-order or hide).
  // NextMoveCard and the monthly-input nudge intentionally stay anchored at
  // the top — they're action prompts, not informational widgets, so making
  // them rearrangeable would risk burying calls to action.
  type WidgetId = 'pills-section' | 'spending' | 'concentration' | 'goals';
  const widgetIds = useMemo<readonly WidgetId[]>(
    () => ['pills-section', 'spending', 'concentration', 'goals'],
    [],
  );
  const widgetLayout = useWidgetLayout(widgetIds);

  const pillsSectionContent: ReactNode = (
    // Pill grid breakpoints are chosen so the *default* 5 pills never strand
    // a single card on its own row. Prior layout was `md:grid-cols-4`, which
    // renders 4-up at md/lg/xl/2xl — leaving the 5th pill (Spending vs
    // Budget) alone on row 2 at every reasonable desktop width. New ladder:
    //   <sm  (mobile)         : 2 cols  → 2+2+1 (acceptable; tall stacks)
    //   sm/md (640-1023px)    : 3 cols  → 3+2  (no stranded card)
    //   lg    (1024-1279px)   : 4 cols  → 4+1  (acceptable; labels stay legible)
    //   xl+   (≥1280px)       : 5 cols  → 5-in-a-row (no stranded card)
    // Wave-5 UX review found `lg:grid-cols-5` (introduced in Wave-4 polish)
    // was tight enough at 1024px to reintroduce mid-word label truncation on
    // longer pill names ("AWAITING REIMBU…"). Bumping the 5-col jump to xl
    // gives those labels breathing room at lg while still going wide at the
    // 1280px+ widths the design QA tracks.
    <div className="space-y-4">
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
        data-testid="dashboard-pill-grid"
      >
        {visiblePills.length === 0 ? (
          <div className="col-span-full rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            All metric pills are hidden. Tap{' '}
            <span className="font-medium">Customize layout</span> to add them back.
          </div>
        ) : (
          visiblePills.map((p, index) => (
            <EditablePill
              key={p.def.id}
              id={p.def.id}
              label={p.def.label}
              editing={editing}
              canMoveUp={index > 0}
              canMoveDown={index < visiblePills.length - 1}
              onMoveUp={() => pillLayout.move(p.def.id, -1)}
              onMoveDown={() => pillLayout.move(p.def.id, 1)}
              onRemove={() => pillLayout.hide(p.def.id)}
            >
              {p.def.render()}
            </EditablePill>
          ))
        )}
      </div>
      {editing && hiddenPills.length > 0 ? (
        <div
          className="rounded-md border bg-muted/40 p-3"
          data-testid="dashboard-hidden-pills"
        >
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Hidden pills
          </div>
          <div className="flex flex-wrap gap-2">
            {hiddenPills.map((p) => (
              <button
                key={p.def.id}
                type="button"
                onClick={() => pillLayout.show(p.def.id)}
                className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-sm hover:bg-accent"
                data-testid={`pill-add-${p.def.id}`}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                {p.def.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  const widgetDefs: Array<{ id: WidgetId; label: string; render: () => ReactNode }> = [
    {
      id: 'pills-section',
      label: 'Metric pills',
      render: () => pillsSectionContent,
    },
    {
      id: 'spending',
      label: 'Spending',
      render: () => (
        <SpendingWidget
          transactions={transactions}
          categories={categories}
          accounts={visibleAccounts}
        />
      ),
    },
    {
      id: 'concentration',
      label: 'Concentration warnings',
      render: () => (
        // ConcentrationCard intentionally stays household-wide regardless of
        // the person filter — its semantics ("is one ticker too big a share
        // of *the portfolio*?") don't change when you focus on a single
        // owner.
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ConcentrationCard />
        </div>
      ),
    },
    {
      id: 'goals',
      label: 'Goals',
      render: () => (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Goals</CardTitle>
            {visibleGoals.length > 0 && (
              <Link to="/goals" className="text-sm text-primary hover:underline">
                View all →
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {visibleGoals.length === 0 ? (
              <EmptyState bare icon={Target} title="No goals yet">
                <Button asChild size="sm" variant="outline">
                  <Link to="/inputs/goals">Add your first goal</Link>
                </Button>
              </EmptyState>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {goalProjections.slice(0, 3).map((p) => (
                  <MiniGoalCard key={p.goal.id} projection={p} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ),
    },
  ];
  const widgetById = new Map(widgetDefs.map((w) => [w.id, w]));
  const orderedWidgets = widgetLayout.layout
    .map((e) => ({ entry: e, def: widgetById.get(e.id as WidgetId) }))
    .filter((row): row is { entry: typeof widgetLayout.layout[number]; def: (typeof widgetDefs)[number] } => row.def !== undefined);
  const visibleWidgets = orderedWidgets.filter((w) => !w.entry.hidden);
  const hiddenWidgets = orderedWidgets.filter((w) => w.entry.hidden);

  return (
    <PageContainer className="space-y-6">
      <StoreErrorBanner errors={storeErrors} onRetry={reload} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold">
            {household?.name ? `Hi, ${household.name}` : 'Dashboard'}
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <p className="text-sm text-muted-foreground">{todayLabel}</p>
            <FreshnessBadge size="sm" />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={editing ? 'default' : 'outline'}
          onClick={() => setEditing((v) => !v)}
          aria-pressed={editing}
          title="Reorder, hide, and re-add pills and widgets."
          data-testid="dashboard-edit-toggle"
        >
          {editing ? (
            <>
              <CheckIcon className="h-5 w-5 mr-1.5" />
              Done
            </>
          ) : (
            <>
              <PencilIcon className="h-5 w-5 mr-1.5" />
              Customize layout
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NextMoveCard />
        <TodaysTriviaCard />
      </div>

      {isInputPending && (
        <div className="rounded-md border border-warning/40 bg-warning-soft p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium text-warning-foreground">Monthly input pending</div>
            <div className="text-sm text-warning-foreground/80">
              Confirm this month's account balances and loan payments.
            </div>
          </div>
          <Button onClick={() => navigate('/monthly')}>Open</Button>
        </div>
      )}

      {visibleWidgets.map((w, index) => (
        <EditableWidget
          key={w.def.id}
          id={w.def.id}
          label={w.def.label}
          editing={editing}
          canMoveUp={index > 0}
          canMoveDown={index < visibleWidgets.length - 1}
          onMoveUp={() => widgetLayout.move(w.def.id, -1)}
          onMoveDown={() => widgetLayout.move(w.def.id, 1)}
          onRemove={() => widgetLayout.hide(w.def.id)}
        >
          {w.def.render()}
        </EditableWidget>
      ))}

      {editing && hiddenWidgets.length > 0 ? (
        <div
          className="rounded-md border bg-muted/40 p-3"
          data-testid="dashboard-hidden-widgets"
        >
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Hidden widgets
          </div>
          <div className="flex flex-wrap gap-2">
            {hiddenWidgets.map((w) => (
              <button
                key={w.def.id}
                type="button"
                onClick={() => widgetLayout.show(w.def.id)}
                className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-sm hover:bg-accent"
                data-testid={`widget-add-${w.def.id}`}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                {w.def.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
