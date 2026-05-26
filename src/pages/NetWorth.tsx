import { useEffect, useMemo } from 'react';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAccountsStore } from '@/stores/accounts-store';
import {
  netWorthForMonth,
  type NetWorthInput,
} from '@/lib/networth';
import {
  filterByObligorPersonId,
  filterByOwnerPersonId,
} from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import NetWorthTimeSeriesChart from '@/components/charts/NetWorthTimeSeriesChart';
import AssetsDonut from '@/components/charts/AssetsDonut';
import LiabilitiesDonut from '@/components/charts/LiabilitiesDonut';

/**
 * NetWorth page — rewritten around the NetWorthTimeSeriesChart + two
 * donuts (per spec 2026-05-26-net-worth-rewrite-design.md). The page is
 * thin: it loads the relevant stores, applies the view filter, derives
 * three MetricCards (current / MoM / YoY), and hands off the rest to
 * the new chart/donut components.
 *
 * The legacy LineChartCard + "Assets by category" + "Liabilities by type"
 * widgets are removed — see git history for the previous implementation.
 */

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

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

function formatSignedCurrency(value: number): string {
  return signedCurrencyFormatter.format(value);
}

function formatPercentDelta(current: number, baseline: number): string {
  if (baseline === 0) return '—';
  const pct = ((current - baseline) / Math.abs(baseline)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Latest YYYY-MM seen in the input — the "current month" of the page. We
 * pick the latest snapshot month if any exist; otherwise today. Avoids
 * showing a flat metric for users mid-month before this month's snapshot
 * has been derived/confirmed.
 */
function pickCurrentMonth(snapshots: { snapshotMonth: string }[]): string {
  if (snapshots.length === 0) {
    return new Date().toISOString().slice(0, 7);
  }
  let max = snapshots[0].snapshotMonth;
  for (const s of snapshots) {
    if (s.snapshotMonth > max) max = s.snapshotMonth;
  }
  return max;
}

function priorMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return prev.toISOString().slice(0, 7);
}

function yearAgoMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const prev = new Date(Date.UTC(y - 1, m - 1, 1));
  return prev.toISOString().slice(0, 7);
}

/**
 * Build the pure-helper input shape from already-filtered store rows. Each
 * arg is the page's view-filtered slice (see Net Worth body below), so the
 * dropdown reaches every aggregation downstream without each derivation
 * having to re-apply the filter.
 */
function buildNetWorthInput(
  snapshots: ReturnType<typeof useSnapshotsStore.getState>['snapshots'],
  properties: ReturnType<typeof usePropertiesStore.getState>['properties'],
  vehicles: ReturnType<typeof useVehiclesStore.getState>['vehicles'],
  loans: ReturnType<typeof useLoansStore.getState>['loans'],
): NetWorthInput {
  return {
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
  };
}

function MetricCard({
  title,
  value,
  description,
  tone,
}: {
  title: string;
  value: string;
  description?: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const valueColor =
    tone === 'positive'
      ? 'text-emerald-600'
      : tone === 'negative'
        ? 'text-red-600'
        : 'text-foreground';
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">
          {title}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-semibold ${valueColor}`}>{value}</div>
        {description ? (
          <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function NetWorth() {
  const { filter, persons } = useViewFilter();

  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const loans = useLoansStore((s) => s.loans);
  const loadLoans = useLoansStore((s) => s.load);
  // Accounts are loaded so the view filter can scope snapshots to accounts
  // owned by the selected person (snapshots themselves carry no owner field;
  // they inherit ownership from their parent account).
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);

  useEffect(() => {
    loadSnapshots();
    loadProperties();
    loadVehicles();
    loadLoans();
    loadAccounts();
  }, [loadSnapshots, loadProperties, loadVehicles, loadLoans, loadAccounts]);

  // Apply the view filter as the data-prep step — every derivation below
  // reads from these filtered slices and stays oblivious to the dropdown.
  const visibleAccounts = useMemo(
    () => filterByOwnerPersonId(accounts, filter, persons),
    [accounts, filter, persons],
  );
  const visibleAccountIds = useMemo(
    () =>
      new Set(
        visibleAccounts
          .map((a) => a.id)
          .filter((id): id is number => id != null),
      ),
    [visibleAccounts],
  );
  const visibleSnapshots = useMemo(
    () =>
      filter === 'household'
        ? snapshots
        : snapshots.filter((s) => visibleAccountIds.has(s.accountId)),
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

  const input = useMemo<NetWorthInput>(
    () =>
      buildNetWorthInput(
        visibleSnapshots,
        visibleProperties,
        visibleVehicles,
        visibleLoans,
      ),
    [visibleSnapshots, visibleProperties, visibleVehicles, visibleLoans],
  );

  const hasAnyData =
    input.snapshots.length > 0 ||
    input.properties.length > 0 ||
    input.vehicles.length > 0 ||
    input.loans.length > 0;

  const currentMonth = pickCurrentMonth(input.snapshots);
  const prev = priorMonth(currentMonth);
  const yearAgo = yearAgoMonth(currentMonth);

  const current = netWorthForMonth(currentMonth, input);
  const priorValue = netWorthForMonth(prev, input);
  const yearAgoValue = netWorthForMonth(yearAgo, input);

  const momDelta = current - priorValue;
  const yoyDelta = current - yearAgoValue;

  if (!hasAnyData) {
    return (
      <div className="p-8 max-w-6xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold mb-1">Net Worth</h1>
            <p className="text-sm text-muted-foreground">
              Track your wealth over time across accounts, property, vehicles,
              and debt.
            </p>
          </div>
          <ImportCsvButton entity="snapshot" />
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No data yet — set up your accounts in{' '}
            <a href="/inputs/accounts" className="underline text-foreground">
              Inputs
            </a>
            .
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Net Worth</h1>
          <p className="text-sm text-muted-foreground">
            As of {currentMonth}. Investments include the latest confirmed
            snapshot per account.
          </p>
        </div>
        <ImportCsvButton entity="snapshot" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard title="Current Net Worth" value={formatCurrency(current)} />
        <MetricCard
          title="Month over Month"
          value={priorValue === 0 ? '—' : formatSignedCurrency(momDelta)}
          description={
            priorValue === 0
              ? 'Need at least 2 months of data'
              : formatPercentDelta(current, priorValue)
          }
          tone={
            priorValue === 0 ? 'neutral' : momDelta >= 0 ? 'positive' : 'negative'
          }
        />
        <MetricCard
          title="Year over Year"
          value={yearAgoValue === 0 ? '—' : formatSignedCurrency(yoyDelta)}
          description={
            yearAgoValue === 0
              ? 'Need 12+ months of data'
              : formatPercentDelta(current, yearAgoValue)
          }
          tone={
            yearAgoValue === 0
              ? 'neutral'
              : yoyDelta >= 0
                ? 'positive'
                : 'negative'
          }
        />
      </div>

      <NetWorthTimeSeriesChart />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AssetsDonut />
        <LiabilitiesDonut />
      </div>
    </div>
  );
}
