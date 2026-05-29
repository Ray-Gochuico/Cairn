import { describe, it, expect } from 'vitest';
import {
  aggregateContributionsByBucket,
  bucketForContribution,
  CONTRIBUTION_BUCKETS,
} from '@/lib/contributions-by-bucket';
import { AccountType, ContributionSource } from '@/types/enums';
import type { Account, Contribution } from '@/types/schema';

function makeAccount(id: number, type: AccountType, patch: Partial<Account> = {}): Account {
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
    ...patch,
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

describe('bucketForContribution', () => {
  it('maps a brokerage contribution to Brokerage', () => {
    const acct = makeAccount(1, AccountType.ACCOUNT_BROKERAGE);
    const c = makeContribution(1, 1, '2026-01-01', 1000);
    expect(bucketForContribution(c, acct)).toBe('Brokerage');
  });

  it('maps a 401k paycheck contribution to 401k', () => {
    const acct = makeAccount(1, AccountType.ACCOUNT_401K);
    const c = makeContribution(1, 1, '2026-01-01', 1000, ContributionSource.PAYCHECK);
    expect(bucketForContribution(c, acct)).toBe('401k');
  });

  it('maps a 401k employer-match contribution to 401k Match (regardless of host account)', () => {
    const acct = makeAccount(1, AccountType.ACCOUNT_401K);
    const c = makeContribution(1, 1, '2026-01-01', 500, ContributionSource.EMPLOYER_MATCH);
    expect(bucketForContribution(c, acct)).toBe('401k Match');
  });

  it('maps each retirement / savings account type to its bucket', () => {
    expect(bucketForContribution(
      makeContribution(1, 1, '2026-01-01', 100),
      makeAccount(1, AccountType.ACCOUNT_ROTH_IRA),
    )).toBe('Roth IRA');
    expect(bucketForContribution(
      makeContribution(1, 1, '2026-01-01', 100),
      makeAccount(1, AccountType.ACCOUNT_TRAD_IRA),
    )).toBe('Trad IRA');
    expect(bucketForContribution(
      makeContribution(1, 1, '2026-01-01', 100),
      makeAccount(1, AccountType.ACCOUNT_HSA),
    )).toBe('HSA');
    expect(bucketForContribution(
      makeContribution(1, 1, '2026-01-01', 100),
      makeAccount(1, AccountType.ACCOUNT_529),
    )).toBe('529');
  });

  it('returns null for non-investment account types (CASH / SAVINGS / CRYPTO)', () => {
    for (const type of [AccountType.ACCOUNT_CASH, AccountType.ACCOUNT_SAVINGS, AccountType.ACCOUNT_CRYPTO] as const) {
      const acct = makeAccount(1, type);
      const c = makeContribution(1, 1, '2026-01-01', 1000);
      expect(bucketForContribution(c, acct)).toBeNull();
    }
  });

  // Guards the stacked contributions chart: every AccountType must reach an
  // explicit case, never the assertNever default. A future type added without
  // handling throws here (and `tsc` reds at the switch) instead of its
  // contributions being silently dropped from the chart.
  it('classifies every AccountType without hitting the exhaustiveness guard', () => {
    for (const type of Object.values(AccountType)) {
      const acct = makeAccount(1, type);
      const c = makeContribution(1, 1, '2026-01-01', 100);
      expect(() => bucketForContribution(c, acct)).not.toThrow();
    }
  });
});

describe('aggregateContributionsByBucket', () => {
  it('returns one row per month in the inclusive range (zero-filled)', () => {
    const result = aggregateContributionsByBucket([], [], '2026-01', '2026-03');
    expect(result.map((r) => r.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    for (const r of result) {
      for (const bucket of CONTRIBUTION_BUCKETS) expect(r[bucket]).toBe(0);
    }
  });

  it('sums contributions into their bucket by month', () => {
    const accounts = [
      makeAccount(1, AccountType.ACCOUNT_BROKERAGE),
      makeAccount(2, AccountType.ACCOUNT_401K),
    ];
    const contributions = [
      makeContribution(1, 1, '2026-01-15', 500), // Brokerage Jan
      makeContribution(2, 1, '2026-01-31', 250), // Brokerage Jan
      makeContribution(3, 2, '2026-01-31', 1000, ContributionSource.PAYCHECK), // 401k Jan
      makeContribution(4, 2, '2026-02-15', 300, ContributionSource.EMPLOYER_MATCH), // 401k Match Feb
    ];
    const result = aggregateContributionsByBucket(contributions, accounts, '2026-01', '2026-02');
    expect(result[0]).toEqual({
      month: '2026-01',
      Brokerage: 750,
      '401k': 1000,
      '401k Match': 0,
      'Roth IRA': 0,
      'Trad IRA': 0,
      HSA: 0,
      '529': 0,
    });
    expect(result[1]).toEqual({
      month: '2026-02',
      Brokerage: 0,
      '401k': 0,
      '401k Match': 300,
      'Roth IRA': 0,
      'Trad IRA': 0,
      HSA: 0,
      '529': 0,
    });
  });

  it('skips contributions whose account is missing from the accounts list', () => {
    const accounts = [makeAccount(1, AccountType.ACCOUNT_BROKERAGE)];
    const contributions = [
      makeContribution(1, 1, '2026-01-15', 500),
      makeContribution(2, 999, '2026-01-15', 999), // orphaned
    ];
    const result = aggregateContributionsByBucket(contributions, accounts, '2026-01', '2026-01');
    expect(result[0].Brokerage).toBe(500);
  });

  it('skips contributions falling outside the requested month range', () => {
    const accounts = [makeAccount(1, AccountType.ACCOUNT_BROKERAGE)];
    const contributions = [
      makeContribution(1, 1, '2025-12-15', 999), // before range
      makeContribution(2, 1, '2026-01-15', 500), // in range
      makeContribution(3, 1, '2026-04-15', 999), // after range
    ];
    const result = aggregateContributionsByBucket(contributions, accounts, '2026-01', '2026-03');
    expect(result.map((r) => r.Brokerage)).toEqual([500, 0, 0]);
  });

  it('skips contributions whose host account type does not map to a bucket', () => {
    const accounts = [
      makeAccount(1, AccountType.ACCOUNT_BROKERAGE),
      makeAccount(2, AccountType.ACCOUNT_CASH),
    ];
    const contributions = [
      makeContribution(1, 1, '2026-01-15', 500),
      makeContribution(2, 2, '2026-01-15', 999), // CASH → no bucket
    ];
    const result = aggregateContributionsByBucket(contributions, accounts, '2026-01', '2026-01');
    expect(result[0].Brokerage).toBe(500);
  });
});
