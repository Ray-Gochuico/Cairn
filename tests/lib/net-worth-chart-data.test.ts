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

function mkVehicle(
  id: number,
  name: string,
  overrides: Partial<Vehicle> = {},
): Vehicle {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    name,
    year: 2020,
    make: 'Toyota',
    model: 'Camry',
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: 22000,
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

  it('prefers asset value snapshot over currentEstimatedValue when both exist', () => {
    const property = mkProperty(10, 'Home', { currentEstimatedValue: 400000 });
    const assetSnaps: AssetValueSnapshot[] = [
      { id: 1, ownerType: 'PROPERTY', ownerId: 10, snapshotDate: '2026-03-15', value: 425000 },
    ];
    const rows = buildNetWorthChartData({
      accounts: [],
      snapshots: [],
      properties: [property],
      vehicles: [],
      loans: [],
      assetValueSnapshots: assetSnaps,
      selectedKeys: new Set([entityKey('property', 10)]),
      granularity: 'MONTH',
      cutoff: null,
      today: '2026-05-31',
    });
    const last = rows[rows.length - 1];
    expect(last[entityKey('property', 10)]).toBe(425000);
  });

  it('anchors a March bucket with an April 1 snapshot if it is the closest data point', () => {
    // March 23 (100) + April 1 (200) account snapshots. March bucket end =
    // March 31. |Mar 23 − Mar 31| = 8, |Apr 1 − Mar 31| = 1 → April 1 wins
    // the March bucket. Pins the closest-date sampling rule for the
    // net-worth chart's account series.
    const rows = buildNetWorthChartData({
      accounts: [mkAccount(1, 'Brokerage')],
      snapshots: [
        mkSnapshot(1, 1, '2026-03-23', 100),
        mkSnapshot(2, 1, '2026-04-01', 200),
      ],
      properties: [],
      vehicles: [],
      loans: [],
      assetValueSnapshots: [],
      selectedKeys: new Set([entityKey('account', 1)]),
      granularity: 'MONTH',
      cutoff: null,
      today: '2026-04-30',
    });
    const marchRow = rows.find((r) =>
      typeof r.bucketEnd === 'string' && r.bucketEnd.startsWith('2026-03'),
    );
    expect(marchRow).toBeDefined();
    expect(marchRow![entityKey('account', 1)]).toBe(200);
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
