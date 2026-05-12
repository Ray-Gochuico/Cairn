import { describe, it, expect } from 'vitest';
import { netWorthForMonth, netWorthSeries } from '@/lib/networth';

const fixture = {
  snapshots: [
    { accountId: 1, snapshotMonth: '2024-05', totalValue: 100000 },
    { accountId: 1, snapshotMonth: '2024-06', totalValue: 105000 },
    { accountId: 2, snapshotMonth: '2024-05', totalValue: 50000 },
    { accountId: 2, snapshotMonth: '2024-06', totalValue: 51000 },
  ],
  properties: [
    { id: 1, currentEstimatedValue: 600000, excludedFromNetWorth: false },
  ],
  vehicles: [
    { id: 1, currentEstimatedValue: 25000, excludedFromNetWorth: false },
  ],
  loans: [
    { id: 1, currentBalance: 350000 },
    { id: 2, currentBalance: 15000 },
  ],
};

describe('netWorthForMonth', () => {
  it('aggregates assets minus liabilities for a single month', () => {
    expect(netWorthForMonth('2024-06', fixture)).toBe(
      105000 + 51000 + 600000 + 25000 - 350000 - 15000
    );
  });
  it('uses the latest snapshot at or before the queried month', () => {
    // No 2024-07 snapshots — fall back to 2024-06
    expect(netWorthForMonth('2024-07', fixture)).toBe(
      105000 + 51000 + 600000 + 25000 - 350000 - 15000
    );
  });
  it('falls back to property/vehicle/loan totals when no snapshots exist', () => {
    expect(netWorthForMonth('2023-01', { ...fixture, snapshots: [] })).toBe(
      600000 + 25000 - 350000 - 15000
    );
  });
});

describe('netWorthSeries', () => {
  it('returns one data point per month in the range', () => {
    const series = netWorthSeries('2024-05', '2024-06', fixture);
    expect(series).toHaveLength(2);
    expect(series[0]).toEqual({ month: '2024-05', netWorth: 100000 + 50000 + 600000 + 25000 - 350000 - 15000 });
    expect(series[1]).toEqual({ month: '2024-06', netWorth: 105000 + 51000 + 600000 + 25000 - 350000 - 15000 });
  });
});
