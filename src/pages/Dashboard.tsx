import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { AccountType, SnapshotSource } from '@/types/enums';
import { netWorthForMonth, type NetWorthInput } from '@/lib/networth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import MetricCard from '@/components/cards/MetricCard';
import type { Account, AccountSnapshot } from '@/types/schema';

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

/**
 * Banner shows when (a) it's the 1st of the month — a hard nudge to confirm
 * the prior month's numbers — OR (b) we have no USER_CONFIRMED/MANUAL
 * snapshot for the current month. AUTO_DERIVED alone counts as "still
 * pending" because the user hasn't ratified the derived value yet.
 *
 * The richer mid-month detection that `src/lib/input-pending.ts` exposes
 * (Task 32) overlays a grace period; Dashboard v1 keeps the rule simple per
 * the prompt and defers the grace-period polish until that helper lands.
 */
function computeInputPending(
  today: Date,
  snapshots: AccountSnapshot[],
  currentMonth: string,
): boolean {
  if (today.getDate() === 1) return true;
  const hasConfirmedThisMonth = snapshots.some(
    (s) =>
      s.snapshotDate.slice(0, 7) === currentMonth &&
      (s.source === SnapshotSource.USER_CONFIRMED ||
        s.source === SnapshotSource.MANUAL),
  );
  return !hasConfirmedThisMonth;
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

  useEffect(() => {
    loadHousehold();
    loadAccounts();
    loadLoans();
    loadSnapshots();
    loadProperties();
    loadVehicles();
  }, [
    loadHousehold,
    loadAccounts,
    loadLoans,
    loadSnapshots,
    loadProperties,
    loadVehicles,
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

  const isInputPending = useMemo(
    () => computeInputPending(today, snapshots, currentMonth),
    [today, snapshots, currentMonth],
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
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 flex items-center justify-between gap-4">
          <div>
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

      <Card>
        <CardHeader>
          <CardTitle>Goals</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground py-8">
          No goals yet. Goals come in Phase 3.
        </CardContent>
      </Card>
    </div>
  );
}
