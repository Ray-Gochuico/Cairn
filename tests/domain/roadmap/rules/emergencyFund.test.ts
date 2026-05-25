import { describe, it, expect } from 'vitest';
import {
  evaluateSmallEmergencyFund,
  evaluateEmergencyFund3Months,
  evaluateEmergencyFund6To12Months,
  totalCashReserve,
} from '@/domain/roadmap/rules/emergencyFund';
import type { RoadmapContext } from '@/types/roadmap';
import type { Account, AccountSnapshot, Household, Person, Transaction } from '@/types/schema';
import { AccountType, FilingStatus, SnapshotSource } from '@/types/enums';

function makeHousehold(patch: Partial<Household> = {}): Household {
  return {
    id: 1,
    name: null,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 5000,
    withdrawalRate: 0.04,
    inflationAssumption: 0.03,
    growthScenarios: [],
    disclaimerAcceptedAt: null,
    disclaimerVersionAccepted: null,
    roadmapDisclaimerAcceptedAt: null,
    roadmapDisclaimerVersionAccepted: null,
    interestThresholdLowPct: null,
    interestThresholdHighPct: null,
    hasWrittenIps: null,
    hasHsaQualifiedHdhp: null,
    makesCharitableGifts: null,
    upcomingLargePurchase: null,
    upcomingPurchaseAmount: null,
    upcomingPurchaseMonths: null,
    ...patch,
  };
}

function makePerson(stability: 'stable' | 'unstable' | null = null): Person {
  return {
    id: 1,
    householdId: 1,
    name: 'Alex',
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: 100_000,
    expectedBonus: 0,
    expectedBonusFrequency: 'ANNUAL',
    bonusIsConsistent: true,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    employmentType: 'SALARY_NO_OT',
    hourlyRate: null,
    regularHoursPerWeek: 40,
    otThresholdHoursPerWeek: null,
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
    jobStability: stability,
    expectsHigherFutureIncome: null,
    onParentHealthInsurance: null,
    isRelativelyHealthy: null,
  };
}

function makeAccount(id: number, type: AccountType, patch: Partial<Account> = {}): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
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

function makeSnapshot(accountId: number, totalValue: number, date = '2026-05-01'): AccountSnapshot {
  return {
    id: accountId,
    accountId,
    snapshotDate: date,
    totalValue,
    source: SnapshotSource.MANUAL,
  };
}

function makeContext(opts: {
  baseline?: number;
  cash?: number;
  hsa?: number;
  savings?: number;
  stability?: 'stable' | 'unstable' | null;
  transactions?: Transaction[];
} = {}): RoadmapContext {
  const accounts: Account[] = [];
  const snapshots: AccountSnapshot[] = [];
  if (opts.cash !== undefined) {
    accounts.push(makeAccount(1, AccountType.ACCOUNT_CASH));
    snapshots.push(makeSnapshot(1, opts.cash));
  }
  if (opts.savings !== undefined) {
    accounts.push(makeAccount(2, AccountType.ACCOUNT_SAVINGS));
    snapshots.push(makeSnapshot(2, opts.savings));
  }
  if (opts.hsa !== undefined) {
    accounts.push(makeAccount(3, AccountType.ACCOUNT_HSA));
    snapshots.push(makeSnapshot(3, opts.hsa));
  }
  return {
    household: makeHousehold({ monthlyExpenseBaseline: opts.baseline ?? 5000 }),
    persons: opts.stability !== undefined ? [makePerson(opts.stability)] : [],
    accounts,
    loans: [],
    contributions: [],
    snapshots,
    transactions: opts.transactions ?? [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-23T12:00:00Z'),
  };
}

function tx(id: number, date: string, amount: number): Transaction {
  return ({
    id,
    householdId: 1,
    date,
    amount,
    merchant: 'M',
    merchantRaw: null,
    categoryId: 1,
    sourceAccountId: 1,
  } as unknown) as Transaction;
}

describe('totalCashReserve', () => {
  it('sums CASH + SAVINGS + HSA latest snapshot values', () => {
    const ctx = makeContext({ cash: 1500, savings: 4000, hsa: 800 });
    expect(totalCashReserve(ctx.accounts, ctx.snapshots)).toBe(6300);
  });

  it('ignores non-cash account types', () => {
    const accounts = [
      makeAccount(1, AccountType.ACCOUNT_BROKERAGE),
      makeAccount(2, AccountType.ACCOUNT_401K),
    ];
    const snapshots = [makeSnapshot(1, 100_000), makeSnapshot(2, 50_000)];
    expect(totalCashReserve(accounts, snapshots)).toBe(0);
  });

  it('uses the latest snapshot per account', () => {
    const accounts = [makeAccount(1, AccountType.ACCOUNT_CASH)];
    const snapshots = [
      makeSnapshot(1, 100, '2026-01-01'),
      makeSnapshot(1, 300, '2026-05-01'),
      makeSnapshot(1, 200, '2026-03-01'),
    ];
    expect(totalCashReserve(accounts, snapshots)).toBe(300);
  });

  it('treats negative snapshots as zero (overdrawn shouldn\'t reduce target met)', () => {
    const accounts = [makeAccount(1, AccountType.ACCOUNT_CASH)];
    const snapshots = [makeSnapshot(1, -500)];
    expect(totalCashReserve(accounts, snapshots)).toBe(0);
  });
});

describe('evaluateSmallEmergencyFund', () => {
  it('returns unanswered when baseline is zero', () => {
    const r = evaluateSmallEmergencyFund(makeContext({ baseline: 0, cash: 5000 }));
    expect(r.status).toBe('unanswered');
  });

  it('target is max($1k, 1 × baseline) — sub-$1k baseline still requires $1k', () => {
    // Baseline $500 → target $1000.
    const below = evaluateSmallEmergencyFund(makeContext({ baseline: 500, cash: 900 }));
    expect(below.status).toBe('active');
    const meets = evaluateSmallEmergencyFund(makeContext({ baseline: 500, cash: 1000 }));
    expect(meets.status).toBe('done');
  });

  it('marks active when cash falls short of the 1× baseline target', () => {
    const r = evaluateSmallEmergencyFund(makeContext({ baseline: 5000, cash: 2000 }));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/\$2,000/);
    expect(r.evidence).toMatch(/\$5,000/);
    expect(r.cta).toBeDefined();
  });

  it('marks done when cash meets the 1× baseline target', () => {
    const r = evaluateSmallEmergencyFund(makeContext({ baseline: 5000, cash: 5000 }));
    expect(r.status).toBe('done');
  });

  it('marks done when cash exceeds the target (no over-funding warning)', () => {
    const r = evaluateSmallEmergencyFund(makeContext({ baseline: 5000, cash: 50_000 }));
    expect(r.status).toBe('done');
  });
});

describe('evaluateEmergencyFund3Months', () => {
  it('returns not-started when stability question is unanswered', () => {
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 15_000 }));
    expect(r.status).toBe('not-started');
  });

  it('skips when stability is unstable (off-branch)', () => {
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 50_000, stability: 'unstable' }));
    expect(r.status).toBe('skipped');
  });

  it('returns active when stable and cash < 3 × baseline', () => {
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 10_000, stability: 'stable' }));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/\$10,000/);
    expect(r.evidence).toMatch(/\$15,000/);
  });

  it('returns done at exactly 3 × baseline', () => {
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 15_000, stability: 'stable' }));
    expect(r.status).toBe('done');
  });
});

describe('evaluateEmergencyFund6To12Months', () => {
  it('returns not-started when stability question is unanswered', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 60_000 }));
    expect(r.status).toBe('not-started');
  });

  it('skips when stability is stable (off-branch)', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 60_000, stability: 'stable' }));
    expect(r.status).toBe('skipped');
  });

  it('returns active when unstable and cash < 6 × baseline', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 15_000, stability: 'unstable' }));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/\$15,000/);
    expect(r.evidence).toMatch(/\$30,000/);
  });

  it('returns done at exactly 6 × baseline (the floor)', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 30_000, stability: 'unstable' }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/6-mo floor/);
  });

  it('returns done with ceiling evidence when cash hits 12 × baseline', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 60_000, stability: 'unstable' }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/12-mo ceiling/);
  });

  it('counts HSA balance toward the EF reserve', () => {
    const r = evaluateEmergencyFund6To12Months(
      makeContext({ baseline: 5000, cash: 10_000, hsa: 20_000, stability: 'unstable' }),
    );
    expect(r.status).toBe('done');
  });
});

describe('emergency-fund rule — real expense baseline from transactions', () => {
  // Adjusted for the expense-sign fix: purchase amounts are positive per the
  // Transaction schema convention.
  it('prefers 12-month rolling avg from transactions over household baseline', () => {
    // 3 months of $4,000 outflows → baseline = $4,000.
    // Household baseline says $5,000 (would have made 3-mo target $15k).
    // With $4,000 real baseline, 3-mo target = $12k → cash $12,500 should mark done.
    const transactions = [
      tx(1, '2026-03-10', 4000),
      tx(2, '2026-04-10', 4000),
      tx(3, '2026-05-10', 4000),
    ];
    const r = evaluateEmergencyFund3Months(
      makeContext({ baseline: 5000, cash: 12_500, stability: 'stable', transactions }),
    );
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/from 12-mo avg/);
  });

  it('falls back to household baseline when no transactions exist', () => {
    const r = evaluateEmergencyFund3Months(
      makeContext({ baseline: 5000, cash: 15_000, stability: 'stable', transactions: [] }),
    );
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/from Household/);
  });

  it('uses monthsObserved as divisor — 4 months of data yields total/4 not total/12', () => {
    // $3,000 spent in each of Feb, Mar, Apr, May → 4 months observed, $12k total.
    // Real baseline = $12,000 / 4 = $3,000.
    // 6-mo unstable target = 6 × $3,000 = $18,000. Cash $18,000 → done.
    const transactions = [
      tx(1, '2026-02-15', 3000),
      tx(2, '2026-03-15', 3000),
      tx(3, '2026-04-15', 3000),
      tx(4, '2026-05-15', 3000),
    ];
    const r = evaluateEmergencyFund6To12Months(
      makeContext({ baseline: 0, cash: 18_000, stability: 'unstable', transactions }),
    );
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/6-mo floor/);
    expect(r.evidence).toMatch(/from 12-mo avg/);
  });

  it('small EF target picks the transactions-derived baseline floor', () => {
    // 2 months of $600 → $1,200 / 2 = $600 baseline.
    // Small target = max($1,000, $600) = $1,000. Cash $900 → active.
    const transactions = [
      tx(1, '2026-04-10', 600),
      tx(2, '2026-05-10', 600),
    ];
    const r = evaluateSmallEmergencyFund(
      makeContext({ baseline: 5000, cash: 900, transactions }),
    );
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/\$1,000/);
    expect(r.evidence).toMatch(/from 12-mo avg/);
  });
});
