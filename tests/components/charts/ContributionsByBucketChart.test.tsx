import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountType, ContributionSource } from '@/types/enums';
import type { Account, Contribution } from '@/types/schema';
import ContributionsByBucketChart from '@/components/charts/ContributionsByBucketChart';

// Mock recharts so the bar chart renders to inspectable DOM in jsdom. Each
// <Bar> becomes a div with its dataKey and stackId; XAxis and YAxis expose
// their props for axis-specific assertions.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  BarChart: ({ children, data }: { children: React.ReactNode; data: unknown }) => (
    <div data-testid="rc-barchart" data-rows={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Bar: ({ dataKey, name, stackId, fill }: { dataKey: string; name: string; stackId?: string; fill: string }) => (
    <div
      data-testid={`bar-${dataKey}`}
      data-name={name}
      data-stackid={stackId ?? ''}
      data-fill={fill}
    />
  ),
  CartesianGrid: () => null,
  XAxis: ({
    interval,
    tickFormatter,
  }: {
    interval?: number | string;
    tickFormatter?: (value: unknown) => string;
  }) => (
    <div
      data-testid="rc-xaxis"
      data-interval={interval !== undefined ? String(interval) : 'default'}
      data-has-formatter={tickFormatter ? 'yes' : 'no'}
      // Sample formatted tick so we can assert abbreviation
      data-sample-tick={tickFormatter ? tickFormatter('2026-01') : 'raw'}
    />
  ),
  YAxis: ({
    tickFormatter,
  }: {
    tickFormatter?: (value: number) => string;
  }) => (
    <div
      data-testid="rc-yaxis"
      data-has-formatter={tickFormatter ? 'yes' : 'no'}
      // Emit formatted values for key thresholds.
      // NOTE: HTML dataset converts hyphens to camelCase:
      //   data-fmt-zero  → dataset.fmtZero
      //   data-fmtv500   → dataset.fmtv500  (no hyphen in numeric part)
      data-fmt-zero={tickFormatter ? tickFormatter(0) : 'raw'}
      data-fmtv500={tickFormatter ? tickFormatter(500) : 'raw'}
      data-fmtv1000={tickFormatter ? tickFormatter(1000) : 'raw'}
      data-fmtv2500={tickFormatter ? tickFormatter(2500) : 'raw'}
    />
  ),
  Tooltip: () => null,
  Legend: () => null,
}));

function makeAccount(id: number, type: AccountType): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: 1,
    beneficiaryDependentId: null,
    name: `Acct ${id}`,
    institution: null,
    type,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
    accentColor: null,
    hasEmployerMatch: null,
    employerMatchPct: null,
    employerMatchLimitPct: null,
    allowsMegaBackdoorRollover: null,
    hasHighFees: null,
  };
}

function makeContribution(
  id: number,
  accountId: number,
  date: string,
  amount: number,
  source: ContributionSource = ContributionSource.PAYCHECK,
): Contribution {
  return { id, accountId, personId: null, date, amount, source };
}

// Minimal non-zero data so the chart renders (all-zero shows the empty
// message now — Wave 11 T11); axis/formatter wiring tests need the chart.
const SEED_ACCOUNTS = [makeAccount(1, AccountType.ACCOUNT_BROKERAGE)];
const SEED_CONTRIBS = [makeContribution(1, 1, '2026-01-15', 500)];

describe('ContributionsByBucketChart', () => {
  it('renders the card title and subtitle', () => {
    render(
      <ContributionsByBucketChart
        accounts={[]}
        contributions={[]}
        fromYyyymm="2026-01"
        toYyyymm="2026-03"
      />,
    );
    expect(screen.getByText('Monthly contributions by bucket')).toBeTruthy();
    expect(
      screen.getByText('Stack height = total; stacked by account type (last 12 months)'),
    ).toBeTruthy();
  });

  it('shows guidance copy and no chart when there are no contributions (Wave 11 T11)', () => {
    render(
      <ContributionsByBucketChart
        accounts={[]}
        contributions={[]}
        fromYyyymm="2026-01"
        toYyyymm="2026-03"
      />,
    );
    expect(
      screen.getByText(/No contributions recorded in this window yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('rc-barchart')).not.toBeInTheDocument();
  });

  it('renders one stacked bar per bucket, all sharing the same stackId', () => {
    render(
      <ContributionsByBucketChart
        accounts={SEED_ACCOUNTS}
        contributions={SEED_CONTRIBS}
        fromYyyymm="2026-01"
        toYyyymm="2026-01"
      />,
    );
    const buckets = ['Brokerage', '401k', '401k Match', 'Roth IRA', 'Trad IRA', 'HSA', '529'];
    const stackIds = new Set<string>();
    for (const bucket of buckets) {
      const bar = screen.getByTestId(`bar-${bucket}`);
      expect(bar).toBeTruthy();
      stackIds.add(bar.dataset.stackid ?? '');
    }
    expect(stackIds.size).toBe(1);
    expect([...stackIds][0]).not.toBe('');
  });

  it('aggregates contributions into the correct bucket rows', () => {
    const accounts = [
      makeAccount(1, AccountType.ACCOUNT_BROKERAGE),
      makeAccount(2, AccountType.ACCOUNT_401K),
    ];
    const contributions = [
      makeContribution(1, 1, '2026-01-15', 500),
      makeContribution(2, 2, '2026-01-31', 1000),
      makeContribution(3, 2, '2026-01-31', 250, ContributionSource.EMPLOYER_MATCH),
    ];
    render(
      <ContributionsByBucketChart
        accounts={accounts}
        contributions={contributions}
        fromYyyymm="2026-01"
        toYyyymm="2026-01"
      />,
    );
    const rows = JSON.parse(screen.getByTestId('rc-barchart').dataset.rows ?? '[]');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      month: '2026-01',
      Brokerage: 500,
      '401k': 1000,
      '401k Match': 250,
    });
  });

  describe('y-axis formatter — adapts to value magnitude (defect sentinel)', () => {
    it('formats sub-$1k values as dollars (e.g. $500) not as "$0.5k"', () => {
      render(
        <ContributionsByBucketChart
          accounts={SEED_ACCOUNTS}
          contributions={SEED_CONTRIBS}
          fromYyyymm="2026-01"
          toYyyymm="2026-01"
        />,
      );
      const yAxis = screen.getByTestId('rc-yaxis');
      // $500 should show as a dollar amount, NOT "$0.5k" which is hard to read
      // and shows as "$0.0k" for amounts < $100 (the reported bug)
      const fmt500 = yAxis.dataset.fmtv500 ?? '';
      expect(fmt500).not.toBe('$0.5k'); // old broken formatter
      expect(fmt500).toMatch(/^\$500$/); // expected: "$500"
    });

    it('formats $0 as "$0" not "$0.0k"', () => {
      render(
        <ContributionsByBucketChart
          accounts={SEED_ACCOUNTS}
          contributions={SEED_CONTRIBS}
          fromYyyymm="2026-01"
          toYyyymm="2026-01"
        />,
      );
      const yAxis = screen.getByTestId('rc-yaxis');
      const fmtZero = yAxis.dataset.fmtZero ?? '';
      expect(fmtZero).not.toBe('$0.0k');
      expect(fmtZero).toBe('$0');
    });

    it('formats $1000 as "$1.0k"', () => {
      render(
        <ContributionsByBucketChart
          accounts={SEED_ACCOUNTS}
          contributions={SEED_CONTRIBS}
          fromYyyymm="2026-01"
          toYyyymm="2026-01"
        />,
      );
      const yAxis = screen.getByTestId('rc-yaxis');
      expect(yAxis.dataset.fmtv1000).toBe('$1.0k');
    });

    it('formats $2500 as "$2.5k"', () => {
      render(
        <ContributionsByBucketChart
          accounts={SEED_ACCOUNTS}
          contributions={SEED_CONTRIBS}
          fromYyyymm="2026-01"
          toYyyymm="2026-01"
        />,
      );
      const yAxis = screen.getByTestId('rc-yaxis');
      expect(yAxis.dataset.fmtv2500).toBe('$2.5k');
    });
  });

  describe('x-axis interval — consistent tick spacing (defect sentinel)', () => {
    it('sets xAxisInterval=0 so all month ticks are shown, not recharts default', () => {
      render(
        <ContributionsByBucketChart
          accounts={SEED_ACCOUNTS}
          contributions={SEED_CONTRIBS}
          fromYyyymm="2026-01"
          toYyyymm="2026-12"
        />,
      );
      const xAxis = screen.getByTestId('rc-xaxis');
      // Must NOT be recharts default; must be 0 (show all ticks)
      expect(xAxis.dataset.interval).not.toBe('default');
      expect(xAxis.dataset.interval).toBe('0');
    });

    it('uses a tick formatter that abbreviates YYYY-MM to short month name', () => {
      render(
        <ContributionsByBucketChart
          accounts={SEED_ACCOUNTS}
          contributions={SEED_CONTRIBS}
          fromYyyymm="2026-01"
          toYyyymm="2026-01"
        />,
      );
      const xAxis = screen.getByTestId('rc-xaxis');
      // The mock renders xTickFormatter('2026-01') as data-sample-tick
      // Should produce a short label like "Jan" or "Jan '26"
      const sampleTick = xAxis.dataset.sampleTick ?? '';
      expect(sampleTick).not.toBe('2026-01'); // must abbreviate
      expect(sampleTick).toMatch(/Jan/);       // must contain the month name
    });
  });
});
