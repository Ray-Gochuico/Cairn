import { describe, it, expect } from 'vitest';
import {
  AccountType,
  LoanType,
  PropertyType,
  SnapshotSource,
} from '@/types/enums';
import { entityKey } from '@/lib/entity-key';
import { buildNetWorthChartData } from '@/lib/net-worth-chart-data';
import type {
  Account,
  AccountSnapshot,
  AssetValueSnapshot,
  Loan,
  Property,
  Vehicle,
} from '@/types/schema';

function mkAccount(
  id: number,
  name: string,
  overrides: Partial<Account> = {},
): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name,
    institution: null,
    type: AccountType.ACCOUNT_BROKERAGE,
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
    apyRate: null,
    ...overrides,
  };
}

function mkSnapshot(
  id: number,
  accountId: number,
  date: string,
  value: number,
): AccountSnapshot {
  return {
    id,
    accountId,
    snapshotDate: date,
    totalValue: value,
    source: SnapshotSource.MANUAL,
  };
}

function mkProperty(
  id: number,
  name: string,
  overrides: Partial<Property> = {},
): Property {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    name,
    type: PropertyType.PRIMARY_RESIDENCE,
    address: null,
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: 400000,
    linkedLoanId: null,
    excludedFromNetWorth: false,
    ...overrides,
  };
}

function mkLoan(
  id: number,
  name: string,
  overrides: Partial<Loan> = {},
): Loan {
  return {
    id,
    householdId: 1,
    obligorPersonId: null,
    name,
    type: LoanType.MORTGAGE,
    originalAmount: 400000,
    currentBalance: 350000,
    interestRate: 0.04,
    termMonths: 360,
    firstPaymentDate: '2024-01-01',
    monthlyPayment: 1909.66,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
    ...overrides,
  };
}

describe('buildNetWorthChartData', () => {
  it('returns empty when no entities are selected', () => {
    const rows = buildNetWorthChartData({
      accounts: [mkAccount(1, 'Brokerage')],
      snapshots: [mkSnapshot(1, 1, '2026-03-15', 5000)],
      properties: [],
      vehicles: [],
      loans: [],
      assetValueSnapshots: [],
      selectedKeys: new Set(),
      granularity: 'MONTH',
      cutoff: null,
      today: '2026-05-15',
    });
    expect(rows).toEqual([]);
  });

  it('stacks asset segments as positive numbers', () => {
    const rows = buildNetWorthChartData({
      accounts: [mkAccount(1, 'Brokerage')],
      snapshots: [mkSnapshot(1, 1, '2026-03-15', 5000)],
      properties: [],
      vehicles: [],
      loans: [],
      assetValueSnapshots: [],
      selectedKeys: new Set([entityKey('account', 1)]),
      granularity: 'MONTH',
      cutoff: null,
      today: '2026-03-31',
    });
    expect(rows.length).toBeGreaterThan(0);
    const last = rows[rows.length - 1];
    expect(last[entityKey('account', 1)]).toBe(5000);
    expect(last.netWorth).toBe(5000);
  });

  it('stacks liability segments as negative numbers (loan stack)', () => {
    const loan = mkLoan(1, 'Mortgage', { currentBalance: 350000 });
    const rows = buildNetWorthChartData({
      accounts: [],
      snapshots: [],
      properties: [],
      vehicles: [],
      loans: [loan],
      assetValueSnapshots: [],
      selectedKeys: new Set([entityKey('loan', 1)]),
      granularity: 'MONTH',
      cutoff: null,
      today: '2026-05-15',
    });
    expect(rows.length).toBeGreaterThan(0);
    const last = rows[rows.length - 1];
    // Loan stack is rendered as negative for downward stacking.
    expect(last[entityKey('loan', 1)]).toBeLessThan(0);
    expect(last.netWorth).toBeLessThan(0);
  });

  it('Net Worth value equals total assets minus total liabilities per bucket', () => {
    const account = mkAccount(1, 'Brokerage');
    const property = mkProperty(10, 'Home', { currentEstimatedValue: 500000 });
    const loan = mkLoan(20, 'Mortgage', { currentBalance: 300000 });
    const rows = buildNetWorthChartData({
      accounts: [account],
      snapshots: [mkSnapshot(1, 1, '2026-04-30', 100000)],
      properties: [property],
      vehicles: [],
      loans: [loan],
      assetValueSnapshots: [],
      selectedKeys: new Set([
        entityKey('account', 1),
        entityKey('property', 10),
        entityKey('loan', 20),
      ]),
      granularity: 'MONTH',
      cutoff: null,
      today: '2026-04-30',
    });
    expect(rows.length).toBeGreaterThan(0);
    const last = rows[rows.length - 1];
    // Account latest: 100000. Property fallback: 500000. Loan: 300000.
    // Net worth = 600000 - 300000 = 300000.
    expect(last[entityKey('account', 1)]).toBe(100000);
    expect(last[entityKey('property', 10)]).toBe(500000);
    expect(last[entityKey('loan', 20)]).toBe(-300000);
    expect(last.netWorth).toBe(300000);
  });

  it('uses currentEstimatedValue fallback when no asset value snapshot exists', () => {
    const property = mkProperty(10, 'Home', { currentEstimatedValue: 425000 });
    const rows = buildNetWorthChartData({
      accounts: [],
      snapshots: [],
      properties: [property],
      vehicles: [],
      loans: [],
      assetValueSnapshots: [],
      selectedKeys: new Set([entityKey('property', 10)]),
      granularity: 'MONTH',
      cutoff: null,
      today: '2026-05-31',
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row[entityKey('property', 10)]).toBe(425000);
    }
  });

  it('drops selected keys whose entities have been deleted', () => {
    const rows = buildNetWorthChartData({
      accounts: [],
      snapshots: [],
      properties: [],
      vehicles: [],
      loans: [],
      assetValueSnapshots: [],
      selectedKeys: new Set([entityKey('account', 999)]),
      granularity: 'MONTH',
      cutoff: null,
      today: '2026-05-15',
    });
    expect(rows).toEqual([]);
  });
});

describe('buildNetWorthChartData — as-of semantics (spec §5.1)', () => {
  const base = {
    properties: [] as Property[],
    vehicles: [] as Vehicle[],
    loans: [] as Loan[],
    assetValueSnapshots: [] as AssetValueSnapshot[],
    granularity: 'MONTH' as const,
    today: '2026-06-12',
  };

  it('spine starts at the first observation bucket (no pre-data buckets)', () => {
    const rows = buildNetWorthChartData({
      ...base,
      accounts: [mkAccount(1, 'Brokerage')],
      snapshots: [mkSnapshot(1, 1, '2026-03-10', 100000)],
      selectedKeys: new Set([entityKey('account', 1)]),
      cutoff: '2026-01-01',
    });
    expect(rows[0].bucketEnd).toBe('2026-03-31');
    expect(rows[0]['account:1']).toBe(100000);
  });

  it('carry-in: a pre-cutoff snapshot values the baseline bucket', () => {
    const rows = buildNetWorthChartData({
      ...base,
      accounts: [mkAccount(1, 'Brokerage')],
      snapshots: [
        mkSnapshot(1, 1, '2025-11-20', 90000),
        mkSnapshot(2, 1, '2026-04-10', 110000),
      ],
      selectedKeys: new Set([entityKey('account', 1)]),
      cutoff: '2026-01-01',
    });
    expect(rows[0].bucketEnd).toBe('2026-01-31');
    expect(rows[0]['account:1']).toBe(90000);
  });

  it('stale account: last value persists into the latest bucket (current is window-stable)', () => {
    const make = (cutoff: string | null) =>
      buildNetWorthChartData({
        ...base,
        accounts: [mkAccount(1, 'Old 401k')],
        snapshots: [mkSnapshot(1, 1, '2025-01-15', 50000)],
        selectedKeys: new Set([entityKey('account', 1)]),
        cutoff,
      });
    const short = make('2026-03-12');
    const all = make(null);
    expect(short[short.length - 1]['account:1']).toBe(50000);
    expect(all[all.length - 1]['account:1']).toBe(50000);
  });

  it('spine is contiguous month ends from window start through today', () => {
    const rows = buildNetWorthChartData({
      ...base,
      accounts: [mkAccount(1, 'A')],
      snapshots: [mkSnapshot(1, 1, '2026-01-10', 1000), mkSnapshot(2, 1, '2026-05-10', 2000)],
      selectedKeys: new Set([entityKey('account', 1)]),
      cutoff: '2026-01-01',
    });
    expect(rows.map((r) => r.bucketEnd)).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
    ]);
    expect(rows.map((r) => r['account:1'])).toEqual([1000, 1000, 1000, 1000, 2000, 2000]);
  });

  it('WEEK spine is consecutive Saturdays from the first observation through today', () => {
    // WEEK is the runtime default granularity — pin the spine at it too.
    const rows = buildNetWorthChartData({
      ...base,
      granularity: 'WEEK',
      accounts: [mkAccount(1, 'A')],
      snapshots: [mkSnapshot(1, 1, '2026-05-20', 1000)],
      selectedKeys: new Set([entityKey('account', 1)]),
      cutoff: '2026-05-01',
    });
    // bucketEndFor(today=2026-06-12, WEEK) = Saturday 2026-06-13.
    expect(rows.map((r) => r.bucketEnd)).toEqual([
      '2026-05-23', '2026-05-30', '2026-06-06', '2026-06-13',
    ]);
    expect(rows.map((r) => r['account:1'])).toEqual([1000, 1000, 1000, 1000]);
  });

  it('sign-flip regression: money moving between tracked accounts nets to ~0 delta', () => {
    const rows = buildNetWorthChartData({
      ...base,
      accounts: [mkAccount(1, 'Checking'), mkAccount(2, 'New brokerage')],
      snapshots: [
        mkSnapshot(1, 1, '2026-01-05', 100000),
        mkSnapshot(2, 1, '2026-03-05', 0),
        mkSnapshot(3, 2, '2026-03-05', 100000),
      ],
      selectedKeys: new Set([entityKey('account', 1), entityKey('account', 2)]),
      cutoff: '2026-01-01',
    });
    expect(rows[0].netWorth).toBe(100000);
    // Account 2's first snapshot is 2026-03-05 — its baseline bucket is 0
    // (0-before-first at the builder level, not just in the helpers).
    expect(rows[0]['account:2']).toBe(0);
    expect(rows[rows.length - 1].netWorth).toBe(100000);
  });

  it('property with purchase info steps 0 → purchasePrice → snapshot', () => {
    const rows = buildNetWorthChartData({
      ...base,
      accounts: [mkAccount(1, 'A')],
      snapshots: [mkSnapshot(1, 1, '2026-01-10', 1000)],
      // purchasePrice deliberately differs from mkProperty's default
      // currentEstimatedValue (400000) so an anchor-field mixup can't pass.
      properties: [mkProperty(7, 'Home', { purchaseDate: '2026-03-15', purchasePrice: 395000 })],
      assetValueSnapshots: [
        { id: 1, ownerType: 'PROPERTY', ownerId: 7, snapshotDate: '2026-05-10', value: 410000 },
      ],
      selectedKeys: new Set([entityKey('account', 1), entityKey('property', 7)]),
      cutoff: '2026-01-01',
    });
    const byEnd = Object.fromEntries(rows.map((r) => [r.bucketEnd, r['property:7']]));
    expect(byEnd['2026-02-28']).toBe(0);
    expect(byEnd['2026-03-31']).toBe(395000);
    expect(byEnd['2026-05-31']).toBe(410000);
  });

  it('loan back-walk receives the injected today (anchor placed by injected clock, not the real one)', () => {
    // today is injected as 2025-01-15 — far in the real clock's past. If the
    // builder threads it, the loan anchor is the last bucket ≤ 2025-01-15
    // (2024-12-31 = currentBalance) and earlier buckets walk HIGHER; if the
    // builder leaks the real clock, 2024-12-31 back-walks above currentBalance
    // and this test fails.
    const rows = buildNetWorthChartData({
      ...base,
      today: '2025-01-15',
      accounts: [mkAccount(1, 'A')],
      snapshots: [mkSnapshot(1, 1, '2024-08-10', 1000)],
      loans: [mkLoan(9, 'Mortgage')],
      selectedKeys: new Set([entityKey('account', 1), entityKey('loan', 9)]),
      cutoff: '2024-07-01',
    });
    const byEnd = Object.fromEntries(rows.map((r) => [r.bucketEnd, r['loan:9']]));
    expect(byEnd['2024-12-31']).toBe(-350000);            // anchor bucket: currentBalance verbatim
    expect(byEnd['2024-11-30'] as number).toBeLessThan(-350000); // one month back-walked → higher balance → more negative
  });
});
