import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountType, SnapshotSource } from '@/types/enums';
import type { Account, AccountSnapshot, Holding } from '@/types/schema';

// Mock recharts so we can read the chart's `data` prop via the DOM —
// jsdom never renders meaningful SVG so the component's `chartData`
// memo is otherwise opaque to tests.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  ComposedChart: ({
    data,
    children,
  }: {
    data: Array<Record<string, number | string>>;
    children: React.ReactNode;
  }) => (
    <div data-testid="rc-composed" data-bucket-count={data.length}>
      <pre data-testid="rc-data">{JSON.stringify(data)}</pre>
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Bar: ({ dataKey }: { dataKey: string }) => (
    <div data-testid={`bar-${dataKey}`} />
  ),
  Line: ({ dataKey }: { dataKey: string }) => (
    <div data-testid={`line-${dataKey}`} />
  ),
}));

import InvestmentTimeSeriesChart from '@/components/charts/InvestmentTimeSeriesChart';

function readChartData(): Array<Record<string, number | string>> {
  const el = screen.queryByTestId('rc-data');
  if (!el) return [];
  return JSON.parse(el.textContent ?? '[]');
}

const ACCOUNT: Account = {
  id: 1,
  householdId: 1,
  ownerPersonId: null,
  beneficiaryDependentId: null,
  name: 'Brokerage',
  institution: null,
  type: AccountType.ACCOUNT_BROKERAGE,
  cryptoWalletAddress: null,
  autoFetchEnabled: false,
  excludedFromNetWorth: false,
  allowMargin: false,
  stateOfPlan: null,
  accentColor: null,
};

const HOLDINGS: Holding[] = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 10, targetAllocationPct: null, costBasis: null },
];

describe('InvestmentTimeSeriesChart — closest-date sampling', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('anchors a bucket with the closest snapshot, even when dated AFTER the bucket end', () => {
    // March 23 + April 1 snapshots. March bucket end = March 31.
    // |Mar 23 − Mar 31| = 8, |Apr 1 − Mar 31| = 1 → April 1 wins.
    // The March row's Brokerage value should be the April 1 value, not
    // the March 23 value (which would win under latest-≤ semantics).
    const snapshots: AccountSnapshot[] = [
      { id: 1, accountId: 1, snapshotDate: '2026-03-23', totalValue: 100, source: SnapshotSource.MANUAL },
      { id: 2, accountId: 1, snapshotDate: '2026-04-01', totalValue: 200, source: SnapshotSource.MANUAL },
    ];
    render(
      <div style={{ width: 800, height: 400 }}>
        <InvestmentTimeSeriesChart
          accounts={[ACCOUNT]}
          holdings={HOLDINGS}
          snapshots={snapshots}
        />
      </div>,
    );

    const data = readChartData();
    expect(data.length).toBeGreaterThan(0);
    const marchRow = data.find((r) =>
      typeof r.bucketEnd === 'string' && r.bucketEnd.startsWith('2026-03'),
    );
    expect(marchRow).toBeDefined();
    expect(marchRow![ACCOUNT.name]).toBe(200);
  });
});
