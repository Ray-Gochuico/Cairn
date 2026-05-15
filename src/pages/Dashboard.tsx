import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
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
import { isMonthlyInputPending, lastMonthYyyymm } from '@/lib/input-pending';
import { computeGoalProgress, type GoalProgressResult } from '@/lib/goal-progress';
import { formatPercent } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import MetricCard from '@/components/cards/MetricCard';
import { ConcentrationCard } from '@/components/cards/ConcentrationCard';
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
 * auto-derived for last month's close. Matches the set in
 * `snapshot-derivation.ts` so the pending-input nudge stays consistent with
 * what derivation actually produces.
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
 * Goals strip: emoji per GoalType, mirrors the icon set on the Goals page.
 * Kept inline to avoid an extra util module for two render sites.
 */
const GOAL_TYPE_ICONS: Record<GoalType, string> = {
  [GoalType.RETIREMENT]: '🏖️',
  [GoalType.DOWN_PAYMENT]: '🏠',
  [GoalType.DEBT_PAYOFF]: '💳',
  [GoalType.EDUCATION]: '🎓',
  [GoalType.EMERGENCY_FUND]: '🛟',
  [GoalType.GENERIC]: '🎯',
};

/**
 * Pick the moderate growth rate for goal projections. Mirrors Goals.tsx /
 * FireCard so all surfaces agree on which scenario drives projections.
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
      className="block rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden>{GOAL_TYPE_ICONS[goal.type] ?? '🎯'}</span>
          <span className="text-sm font-medium truncate">{goal.name}</span>
        </div>
        <span
          className={
            onTrack
              ? 'text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100 whitespace-nowrap'
              : 'text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100 whitespace-nowrap'
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
          className={onTrack ? 'h-full bg-emerald-500' : 'h-full bg-amber-500'}
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

  const household = useHouseholdStore((s) => s.household);
  const loadHousehold = useHouseholdStore((s) => s.load);

  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);

  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);

  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);

  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);

  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);

  const goals = useGoalsStore((s) => s.goals);
  const loadGoals = useGoalsStore((s) => s.load);

  const contributions = useContributionsStore((s) => s.contributions);
  const loadContributions = useContributionsStore((s) => s.load);

  // Holdings + tickers + fund-holdings feed the ConcentrationCard via
  // useConcentration(). Loaded here so the card renders against populated
  // data on first paint instead of an empty "0 warnings" flash.
  const loadHoldings = useHoldingsStore((s) => s.load);
  const loadTickers = useTickersStore((s) => s.load);
  const loadFundHoldings = useFundHoldingsStore((s) => s.load);

  useEffect(() => {
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
  ]);

  const today = useMemo(() => new Date(), []);
  const currentMonth = useMemo(() => currentYyyymm(), []);
  const previousMonth = useMemo(() => priorYyyymm(currentMonth), [currentMonth]);

  const netWorthInput = useMemo<NetWorthInput>(() => ({
    snapshots: snapshots.map((s) => ({
      accountId: s.accountId,
      snapshotMonth: s.snapshotDate.slice(0, 7),
      totalValue: s.totalValue,
    })),
    properties: properties.map((p) => ({
      id: p.id!,
      currentEstimatedValue: p.currentEstimatedValue,
      excludedFromNetWorth: p.excludedFromNetWorth,
    })),
    vehicles: vehicles.map((v) => ({
      id: v.id!,
      currentEstimatedValue: v.currentEstimatedValue,
      excludedFromNetWorth: v.excludedFromNetWorth,
    })),
    loans: loans.map((l) => ({ id: l.id!, currentBalance: l.currentBalance })),
  }), [snapshots, properties, vehicles, loans]);

  const currentNetWorth = useMemo(
    () => netWorthForMonth(currentMonth, netWorthInput),
    [currentMonth, netWorthInput],
  );

  const previousNetWorth = useMemo(
    () => netWorthForMonth(previousMonth, netWorthInput),
    [previousMonth, netWorthInput],
  );

  const totalDebt = useMemo(
    () => loans.reduce((sum, l) => sum + l.currentBalance, 0),
    [loans],
  );

  const liquidInvestments = useMemo(
    () => computeLiquidInvestments(accounts, snapshots, currentMonth),
    [accounts, snapshots, currentMonth],
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
    if (goals.length === 0) return [];
    const latestMap = latestSnapshotPerAccount(snapshots);
    return goals.map((g) => {
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
  }, [goals, snapshots, contributions, today, annualGrowthRate]);

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
      accounts
        .filter(
          (a) =>
            a.id !== undefined &&
            !a.excludedFromNetWorth &&
            !MANUAL_BALANCE_TYPES.has(a.type),
        )
        .map((a) => a.id as number),
    [accounts],
  );

  const lastMonth = useMemo(() => lastMonthYyyymm(today), [today]);

  const snapshotsLastMonth = useMemo(
    () => snapshots.filter((s) => s.snapshotDate.slice(0, 7) === lastMonth),
    [snapshots, lastMonth],
  );

  const isInputPending = useMemo(
    () =>
      isMonthlyInputPending(today, {
        accountIds: pendingAccountIds,
        snapshotsLastMonth,
      }),
    [today, pendingAccountIds, snapshotsLastMonth],
  );

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

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">
          {household?.name ? `Hi, ${household.name}` : 'Dashboard'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{todayLabel}</p>
      </div>

      {isInputPending && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium text-amber-900">Monthly input pending</div>
            <div className="text-sm text-amber-900/80">
              Confirm this month's account balances and loan payments.
            </div>
          </div>
          <Button onClick={() => navigate('/monthly')}>Open</Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Net Worth"
          value={formatUSD(currentNetWorth)}
          href="/net-worth"
          delta={netWorthDeltaLabel}
          deltaTone={netWorthDeltaTone}
          subtitle={hasNetWorthBaseline ? 'vs last month' : undefined}
        />
        <MetricCard
          label="Total Debt"
          value={formatUSD(totalDebt)}
          href="/loans"
          subtitle={loans.length > 0
            ? `Across ${loans.length} loan${loans.length === 1 ? '' : 's'}`
            : undefined}
        />
        <MetricCard
          label="Liquid Investments"
          value={formatUSD(liquidInvestments)}
          href="/investments"
          subtitle="Brokerage, cash, savings, HSA"
        />
        <MetricCard
          label="Monthly Cash Flow"
          value="—"
          subtitle="Available with Phase 4 spending data"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ConcentrationCard />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Goals</CardTitle>
          {goals.length > 0 && (
            <Link to="/goals" className="text-sm text-primary hover:underline">
              View all →
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {goals.length === 0 ? (
            <div className="text-center text-muted-foreground py-6 space-y-3">
              <div>No goals yet.</div>
              <Button asChild size="sm" variant="outline">
                <Link to="/inputs/goals">Add your first goal</Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {goalProjections.slice(0, 3).map((p) => (
                <MiniGoalCard key={p.goal.id} projection={p} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
