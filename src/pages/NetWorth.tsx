import { useEffect, useMemo } from 'react';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import {
  netWorthForMonth,
  netWorthSeries,
  type NetWorthInput,
} from '@/lib/networth';
import { monthsBetween } from '@/lib/business-days';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import LineChartCard from '@/components/charts/LineChartCard';
import BarChartCard from '@/components/charts/BarChartCard';
import type { Loan } from '@/types/schema';
import { LoanType } from '@/types/enums';

/**
 * NetWorth page — Phase 2 visualization surface.
 *
 * Composition: pulls from snapshots/properties/vehicles/loans stores, reshapes
 * into the pure-helper input shape, and renders metric cards + a 12-month
 * line chart + breakdown bars. Recharts only enters via the chart card
 * wrappers (see conventions.md "no Recharts outside src/components/charts").
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
 * Latest YYYY-MM seen in the input — the "current month" of the chart. We
 * pick the latest snapshot month if any exist; otherwise today. Avoids
 * showing a flat chart for users mid-month before this month's snapshot
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
 * Sum the latest snapshot value per account at or before `month`. Used by
 * the breakdown card to count "Investments" without re-summing duplicate
 * snapshots across months.
 */
function latestSnapshotsTotal(
  snapshots: { accountId: number; snapshotMonth: string; totalValue: number }[],
  month: string,
): number {
  const byAccount = new Map<number, { snapshotMonth: string; totalValue: number }>();
  for (const s of snapshots) {
    if (s.snapshotMonth > month) continue;
    const existing = byAccount.get(s.accountId);
    if (!existing || existing.snapshotMonth < s.snapshotMonth) {
      byAccount.set(s.accountId, { snapshotMonth: s.snapshotMonth, totalValue: s.totalValue });
    }
  }
  return [...byAccount.values()].reduce((a, b) => a + b.totalValue, 0);
}

function loanTypeLabel(type: LoanType): string {
  switch (type) {
    case LoanType.MORTGAGE: return 'Mortgage';
    case LoanType.AUTO: return 'Auto';
    case LoanType.STUDENT: return 'Student';
    case LoanType.PERSONAL: return 'Personal';
    case LoanType.CREDIT_CARD: return 'Credit Card';
    case LoanType.OTHER: return 'Other';
  }
}

function liabilitiesByType(loans: Loan[]): { type: string; total: number }[] {
  const buckets = new Map<LoanType, number>();
  for (const l of loans) {
    buckets.set(l.type, (buckets.get(l.type) ?? 0) + l.currentBalance);
  }
  return [...buckets.entries()]
    .map(([type, total]) => ({ type: loanTypeLabel(type), total }))
    .sort((a, b) => b.total - a.total);
}

function useNetWorthData(): NetWorthInput {
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const properties = usePropertiesStore((s) => s.properties);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loans = useLoansStore((s) => s.loans);

  return useMemo<NetWorthInput>(() => ({
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
    tone === 'positive' ? 'text-emerald-600'
    : tone === 'negative' ? 'text-red-600'
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
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const loadProperties = usePropertiesStore((s) => s.load);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const loadLoans = useLoansStore((s) => s.load);
  const loans = useLoansStore((s) => s.loans);

  useEffect(() => {
    loadSnapshots();
    loadProperties();
    loadVehicles();
    loadLoans();
  }, [loadSnapshots, loadProperties, loadVehicles, loadLoans]);

  const input = useNetWorthData();

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

  const seriesStart = monthsBetween(yearAgo, currentMonth)[0];
  const series = netWorthSeries(seriesStart, currentMonth, input);

  // Breakdown for current month
  const investments = latestSnapshotsTotal(input.snapshots, currentMonth);
  const propertyValue = input.properties
    .filter((p) => !p.excludedFromNetWorth)
    .reduce((a, b) => a + (b.currentEstimatedValue ?? 0), 0);
  const vehicleValue = input.vehicles
    .filter((v) => !v.excludedFromNetWorth)
    .reduce((a, b) => a + (b.currentEstimatedValue ?? 0), 0);

  const breakdown = [
    { category: 'Investments', value: investments },
    { category: 'Property', value: propertyValue },
    { category: 'Vehicles', value: vehicleValue },
  ].filter((b) => b.value > 0);

  const breakdownTotal = breakdown.reduce((a, b) => a + b.value, 0);
  const liabilities = liabilitiesByType(loans);
  const liabilitiesTotal = liabilities.reduce((a, b) => a + b.total, 0);

  if (!hasAnyData) {
    return (
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-semibold mb-1">Net Worth</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Track your wealth over time across accounts, property, vehicles, and debt.
        </p>
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
      <div>
        <h1 className="text-2xl font-semibold mb-1">Net Worth</h1>
        <p className="text-sm text-muted-foreground">
          As of {currentMonth}. Investments include the latest confirmed snapshot per account.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Current Net Worth"
          value={formatCurrency(current)}
        />
        <MetricCard
          title="Month over Month"
          value={priorValue === 0 ? '—' : formatSignedCurrency(momDelta)}
          description={
            priorValue === 0
              ? 'Need at least 2 months of data'
              : formatPercentDelta(current, priorValue)
          }
          tone={priorValue === 0 ? 'neutral' : momDelta >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          title="Year over Year"
          value={yearAgoValue === 0 ? '—' : formatSignedCurrency(yoyDelta)}
          description={
            yearAgoValue === 0
              ? 'Need 12+ months of data'
              : formatPercentDelta(current, yearAgoValue)
          }
          tone={yearAgoValue === 0 ? 'neutral' : yoyDelta >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <LineChartCard
        title="Net Worth"
        subtitle="Last 12 months"
        data={series}
        xKey="month"
        series={[{ dataKey: 'netWorth', label: 'Net Worth' }]}
        yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {breakdown.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Assets by category</CardTitle>
              <CardDescription>Current month, excludes net-worth-excluded items</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {breakdown.map((b) => {
                  const pct = breakdownTotal === 0
                    ? 0
                    : (b.value / breakdownTotal) * 100;
                  return (
                    <li
                      key={b.category}
                      className="flex items-center justify-between py-2 border-b last:border-b-0"
                    >
                      <span className="font-medium">{b.category}</span>
                      <span className="text-right">
                        <span className="font-mono">{formatCurrency(b.value)}</span>
                        <span className="ml-2 text-sm text-muted-foreground">
                          {pct.toFixed(1)}%
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Assets by category</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              No assets recorded yet.
            </CardContent>
          </Card>
        )}

        {liabilities.length > 0 ? (
          <BarChartCard
            title="Liabilities by type"
            subtitle={`Total debt ${formatCurrency(liabilitiesTotal)}`}
            data={liabilities}
            xKey="type"
            series={[{ dataKey: 'total', label: 'Balance' }]}
            yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            layout="vertical"
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Liabilities by type</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              No loans recorded yet.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
