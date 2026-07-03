import { describe, it, expect } from 'vitest';
import { computeAccountBreakdown } from '@/lib/account-breakdown';
import { latestPerAccountOnOrBefore } from '@/lib/growth-horizons';
import { AccountType } from '@/types/enums';
import type { Account, AccountSnapshot } from '@/types/schema';

/**
 * Minimal Account factory. Only the fields computeAccountBreakdown reads
 * (id, name, type, excludedFromNetWorth, accentColor) matter; the rest are
 * filled with schema-valid defaults so we never accidentally depend on them.
 */
function acct(over: Partial<Account> & { id: number; type: AccountType }): Account {
  return {
    id: over.id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: over.name ?? `Account ${over.id}`,
    institution: over.institution ?? null,
    type: over.type,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: over.excludedFromNetWorth ?? false,
    allowMargin: false,
    stateOfPlan: null,
    accentColor: over.accentColor ?? null,
    hasEmployerMatch: null,
    employerMatchPct: null,
    employerMatchLimitPct: null,
    allowsMegaBackdoorRollover: null,
    hasHighFees: null,
    apyRate: null,
  };
}

function snap(accountId: number, snapshotDate: string, totalValue: number): AccountSnapshot {
  return { accountId, snapshotDate, totalValue, source: 'MANUAL' as AccountSnapshot['source'] };
}

// A fixed "now" so baseline math is deterministic. 2026-05-28 UTC midnight;
// the 1-month baseline date for this is 2026-04-28 (mirrors growth-horizons).
const NOW = new Date('2026-05-28T00:00:00Z');
const ONE_MONTH_AGO = '2026-04-28';

describe('latestPerAccountOnOrBefore', () => {
  const snapshots = [
    snap(1, '2026-01-01', 100),
    snap(1, '2026-03-01', 150),
    snap(1, '2026-06-01', 200), // strictly after the cutoffs below
    snap(2, '2026-02-01', 50),
    snap(2, '2026-04-01', 70),
  ];

  it('returns the latest snapshot on-or-before the date, per account', () => {
    const m = latestPerAccountOnOrBefore(snapshots, '2026-04-15');
    expect(m.get(1)).toEqual({ date: '2026-03-01', value: 150 });
    expect(m.get(2)).toEqual({ date: '2026-04-01', value: 70 });
    expect(m.size).toBe(2);
  });

  it('includes a snapshot dated exactly on the boundary', () => {
    const m = latestPerAccountOnOrBefore(snapshots, '2026-03-01');
    expect(m.get(1)).toEqual({ date: '2026-03-01', value: 150 });
    expect(m.get(2)).toEqual({ date: '2026-02-01', value: 50 });
  });

  it('excludes snapshots strictly after the cutoff', () => {
    const m = latestPerAccountOnOrBefore(snapshots, '2026-05-01');
    expect(m.get(1)).toEqual({ date: '2026-03-01', value: 150 }); // not 2026-06-01
  });

  it('returns an empty map when nothing is on-or-before the date', () => {
    expect(latestPerAccountOnOrBefore(snapshots, '2025-12-31').size).toBe(0);
  });

  it('respects the accountIds filter', () => {
    const m = latestPerAccountOnOrBefore(snapshots, '2026-04-15', new Set([1]));
    expect(m.size).toBe(1);
    expect(m.get(1)).toEqual({ date: '2026-03-01', value: 150 });
  });
});

describe('computeAccountBreakdown', () => {
  it('computes per-account current value as the latest snapshot', () => {
    const accounts = [
      acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' }),
      acct({ id: 2, type: AccountType.ACCOUNT_401K, name: '401k' }),
    ];
    const snapshots = [
      snap(1, '2026-05-01', 6000),
      snap(1, '2026-05-20', 6000), // latest for acct 1
      snap(2, '2026-05-15', 4000), // latest for acct 2
    ];
    const { rows } = computeAccountBreakdown(accounts, snapshots, NOW);
    const r1 = rows.find((r) => r.accountId === 1)!;
    const r2 = rows.find((r) => r.accountId === 2)!;
    expect(r1.currentValue).toBe(6000);
    expect(r2.currentValue).toBe(4000);
  });

  it('makes % of portfolio sum to ~100% across rows', () => {
    const accounts = [
      acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE }),
      acct({ id: 2, type: AccountType.ACCOUNT_401K }),
      acct({ id: 3, type: AccountType.ACCOUNT_ROTH_IRA }),
    ];
    const snapshots = [
      snap(1, '2026-05-01', 5000),
      snap(2, '2026-05-01', 3000),
      snap(3, '2026-05-01', 2000),
    ];
    const { rows, total } = computeAccountBreakdown(accounts, snapshots, NOW);
    const sumPct = rows.reduce((a, r) => a + (r.pctOfTotal ?? 0), 0);
    expect(sumPct).toBeCloseTo(1, 10);
    expect(total.currentValue).toBe(10000);
    expect(total.pctOfTotal).toBe(1); // total is always 100%
    // Spot-check individual weights.
    expect(rows.find((r) => r.accountId === 1)!.pctOfTotal).toBeCloseTo(0.5, 10);
    expect(rows.find((r) => r.accountId === 2)!.pctOfTotal).toBeCloseTo(0.3, 10);
    expect(rows.find((r) => r.accountId === 3)!.pctOfTotal).toBeCloseTo(0.2, 10);
  });

  it('computes change vs last month (abs + pct) against the 1-month baseline', () => {
    const accounts = [acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE })];
    const snapshots = [
      // baseline = latest snapshot on-or-before 2026-04-28
      snap(1, '2026-04-10', 1000),
      snap(1, '2026-05-20', 1100), // current
    ];
    const { rows, total } = computeAccountBreakdown(accounts, snapshots, NOW);
    const r1 = rows[0];
    expect(r1.valueAsOf).toBe(1000); // latest <= 2026-04-28
    expect(r1.currentValue).toBe(1100);
    expect(r1.changeAbs).toBe(100);
    expect(r1.changePct).toBeCloseTo(0.1, 10);
    // Total mirrors the single row here.
    expect(total.valueAsOf).toBe(1000);
    expect(total.changeAbs).toBe(100);
    expect(total.changePct).toBeCloseTo(0.1, 10);
  });

  it('uses the same 1-month baseline date as growth-horizons (2026-04-28)', () => {
    const accounts = [acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE })];
    // A snapshot dated exactly on the baseline date must count as the baseline;
    // a snapshot dated the day AFTER must NOT.
    const onBoundary = [snap(1, ONE_MONTH_AGO, 900), snap(1, '2026-05-20', 1000)];
    const dayAfter = [snap(1, '2026-04-29', 900), snap(1, '2026-05-20', 1000)];
    expect(computeAccountBreakdown(accounts, onBoundary, NOW).rows[0].valueAsOf).toBe(900);
    // 2026-04-29 is strictly after 2026-04-28 → no baseline → null change.
    const after = computeAccountBreakdown(accounts, dayAfter, NOW).rows[0];
    expect(after.valueAsOf).toBeNull();
    expect(after.changeAbs).toBeNull();
    expect(after.changePct).toBeNull();
  });

  it('renders null (em-dash) change when there is no baseline snapshot', () => {
    const accounts = [acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE })];
    // Only a current snapshot, nothing on-or-before 2026-04-28.
    const snapshots = [snap(1, '2026-05-20', 1000)];
    const { rows, total } = computeAccountBreakdown(accounts, snapshots, NOW);
    expect(rows[0].currentValue).toBe(1000);
    expect(rows[0].valueAsOf).toBeNull();
    expect(rows[0].changeAbs).toBeNull();
    expect(rows[0].changePct).toBeNull();
    // Total: current present, baseline absent → null change, never 0/NaN.
    expect(total.currentValue).toBe(1000);
    expect(total.valueAsOf).toBeNull();
    expect(total.changeAbs).toBeNull();
    expect(total.changePct).toBeNull();
  });

  it('nulls changePct (but not changeAbs) when the baseline is exactly 0', () => {
    const accounts = [acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE })];
    const snapshots = [snap(1, '2026-04-10', 0), snap(1, '2026-05-20', 500)];
    const { rows } = computeAccountBreakdown(accounts, snapshots, NOW);
    expect(rows[0].valueAsOf).toBe(0);
    expect(rows[0].changeAbs).toBe(500);
    expect(rows[0].changePct).toBeNull(); // division-by-zero guard
  });

  it('guards divide-by-zero: total <= 0 yields null pct, no NaN/Infinity', () => {
    const accounts = [
      acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE }),
      acct({ id: 2, type: AccountType.ACCOUNT_401K }),
    ];
    // Both accounts net to zero total.
    const snapshots = [snap(1, '2026-05-01', 100), snap(2, '2026-05-01', -100)];
    const { rows, total } = computeAccountBreakdown(accounts, snapshots, NOW);
    expect(total.currentValue).toBe(0);
    for (const r of rows) {
      expect(r.pctOfTotal).toBeNull();
      expect(Number.isFinite(r.pctOfTotal ?? 0)).toBe(true);
    }
  });

  it('excludes accounts flagged excludedFromNetWorth', () => {
    const accounts = [
      acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE }),
      acct({ id: 2, type: AccountType.ACCOUNT_BROKERAGE, excludedFromNetWorth: true }),
    ];
    const snapshots = [snap(1, '2026-05-01', 1000), snap(2, '2026-05-01', 9999)];
    const { rows, total } = computeAccountBreakdown(accounts, snapshots, NOW);
    expect(rows.map((r) => r.accountId)).toEqual([1]);
    expect(total.currentValue).toBe(1000); // excluded account's 9999 not counted
  });

  it('investableOnly drops CASH/SAVINGS from rows AND the % denominator', () => {
    const accounts = [
      acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' }),
      acct({ id: 2, type: AccountType.ACCOUNT_CASH, name: 'Checking' }),
      acct({ id: 3, type: AccountType.ACCOUNT_SAVINGS, name: 'Savings' }),
    ];
    const snapshots = [
      snap(1, '2026-05-01', 8000),
      snap(2, '2026-05-01', 1000),
      snap(3, '2026-05-01', 1000),
    ];

    // Default OFF: all three counted, % sums to 100% across all.
    const off = computeAccountBreakdown(accounts, snapshots, NOW);
    expect(off.rows.map((r) => r.accountId).sort()).toEqual([1, 2, 3]);
    expect(off.total.currentValue).toBe(10000);
    expect(off.rows.find((r) => r.accountId === 1)!.pctOfTotal).toBeCloseTo(0.8, 10);

    // ON: cash + savings drop from rows AND denominator → brokerage is 100%.
    const on = computeAccountBreakdown(accounts, snapshots, NOW, { investableOnly: true });
    expect(on.rows.map((r) => r.accountId)).toEqual([1]);
    expect(on.total.currentValue).toBe(8000); // 1000 + 1000 removed from denom
    expect(on.rows[0].pctOfTotal).toBeCloseTo(1, 10);
  });

  it('Total equals the sum of included rows (not summed per-row percentages)', () => {
    const accounts = [
      acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE }),
      acct({ id: 2, type: AccountType.ACCOUNT_401K }),
    ];
    const snapshots = [
      snap(1, '2026-04-10', 1000),
      snap(1, '2026-05-20', 1200),
      snap(2, '2026-04-10', 2000),
      snap(2, '2026-05-20', 2300),
    ];
    const { rows, total } = computeAccountBreakdown(accounts, snapshots, NOW);
    const sumCurrent = rows.reduce((a, r) => a + (r.currentValue ?? 0), 0);
    const sumBaseline = rows.reduce((a, r) => a + (r.valueAsOf ?? 0), 0);
    expect(total.currentValue).toBe(sumCurrent); // 3500
    expect(total.valueAsOf).toBe(sumBaseline); // 3000
    expect(total.changeAbs).toBe(500); // 3500 - 3000
    expect(total.changePct).toBeCloseTo(500 / 3000, 10);
  });

  it('an account with no snapshots yields null current value and 0%-ish (null) pct', () => {
    const accounts = [
      acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE }),
      acct({ id: 2, type: AccountType.ACCOUNT_401K, name: 'Empty 401k' }),
    ];
    const snapshots = [snap(1, '2026-05-01', 1000)]; // none for acct 2
    const { rows, total } = computeAccountBreakdown(accounts, snapshots, NOW);
    const r2 = rows.find((r) => r.accountId === 2)!;
    expect(r2.currentValue).toBeNull();
    expect(r2.valueAsOf).toBeNull();
    expect(r2.changeAbs).toBeNull();
    expect(r2.changePct).toBeNull();
    expect(r2.pctOfTotal).toBeNull(); // null current → can't be a share of total
    // Total only reflects accounts that have a value.
    expect(total.currentValue).toBe(1000);
  });

  it('carries through name and type on each row, preserving input order', () => {
    const accounts = [
      acct({ id: 7, type: AccountType.ACCOUNT_HSA, name: 'HSA' }),
      acct({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Taxable' }),
    ];
    const snapshots = [snap(7, '2026-05-01', 100), snap(3, '2026-05-01', 200)];
    const { rows } = computeAccountBreakdown(accounts, snapshots, NOW);
    expect(rows.map((r) => r.accountId)).toEqual([7, 3]); // input order preserved
    expect(rows[0]).toMatchObject({ name: 'HSA', type: AccountType.ACCOUNT_HSA });
    expect(rows[1]).toMatchObject({ name: 'Taxable', type: AccountType.ACCOUNT_BROKERAGE });
  });
});

describe('one-month baseline inherits the month-end clamp (Wave 2 §7)', () => {
  it('Mar 31 baseline is Feb 28 — a Mar 2 snapshot no longer poses as "last month"', () => {
    const account = acct({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' });
    const snapshots = [
      snap(1, '2026-02-27', 111),
      snap(1, '2026-03-02', 222),
      snap(1, '2026-03-30', 333),
    ];
    const out = computeAccountBreakdown([account], snapshots, new Date('2026-03-31T12:00:00Z'));
    // Old bug: baseline 2026-03-03 → picked the Mar 2 snapshot (222).
    expect(out.rows[0].valueAsOf).toBe(111);
    expect(out.rows[0].currentValue).toBe(333);
  });
});
