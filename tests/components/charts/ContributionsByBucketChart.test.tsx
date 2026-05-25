import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountType, ContributionSource } from '@/types/enums';
import type { Account, Contribution } from '@/types/schema';
import ContributionsByBucketChart from '@/components/charts/ContributionsByBucketChart';

// Mock recharts so the bar chart renders to inspectable DOM in jsdom. Each
// <Bar> becomes a div with its dataKey and stackId; this lets us assert
// stacking is wired through without needing real SVG.
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
  XAxis: () => null,
  YAxis: () => null,
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

  it('renders one stacked bar per bucket, all sharing the same stackId', () => {
    render(
      <ContributionsByBucketChart
        accounts={[]}
        contributions={[]}
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
});
