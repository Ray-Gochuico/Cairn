import { describe, it, expect } from 'vitest';
import { computeMagi } from '@/domain/roadmap/rules/iraBranch';
import { evaluateEmployerMatchQ } from '@/domain/roadmap/rules/section1';
import { evaluateMax401k } from '@/domain/roadmap/rules/sections5to6';
import { evaluateAfterTax401kQ } from '@/domain/roadmap/rules/section4Misc';
import type { Account, Contribution, Household, Person } from '@/types/schema';
import type { RoadmapContext } from '@/types/roadmap';
import { AccountType, ContributionSource, FilingStatus } from '@/types/enums';

// ── Helpers: copied verbatim from tests/domain/roadmap/rules/sections5to6.test.ts
// (fully typed, zero `as` casts) — keep in sync with that file if schema changes.

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

function makePerson(patch: Partial<Person> = {}): Person {
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
    jobStability: null,
    expectsHigherFutureIncome: null,
    onParentHealthInsurance: null,
    isRelativelyHealthy: null,
    ...patch,
  };
}

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

function makeContribution(opts: {
  accountId: number;
  amount: number;
  date: string;
  source?: ContributionSource;
}): Contribution {
  return {
    id: Math.floor(Math.random() * 1e9),
    accountId: opts.accountId,
    personId: 1,
    date: opts.date,
    amount: opts.amount,
    source: opts.source ?? ContributionSource.PAYCHECK,
  };
}

function makeContext(patch: Partial<RoadmapContext> = {}): RoadmapContext {
  return {
    household: makeHousehold(),
    persons: [],
    accounts: [],
    loans: [],
    contributions: [],
    snapshots: [],
    transactions: [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-23T00:00:00Z'),
    ...patch,
  };
}

describe('Roth 401k roadmap classification (product decisions)', () => {
  it('Roth-401k contributions do NOT reduce MAGI (post-tax)', () => {
    const ctx = makeContext({
      persons: [makePerson({ id: 1, annualSalaryPretax: 100_000 })],
      accounts: [makeAccount(7, AccountType.ACCOUNT_ROTH_401K)],
      contributions: [
        makeContribution({ accountId: 7, amount: 20_000, date: '2026-03-01' }),
      ],
    });
    // salary 100k, Roth-401k 20k is post-tax → MAGI stays 100k (not 80k).
    expect(computeMagi(ctx)).toBe(100_000);
  });

  it('a Roth 401k counts as an employer-match-eligible retirement account', () => {
    const res = evaluateEmployerMatchQ(
      makeContext({ accounts: [makeAccount(7, AccountType.ACCOUNT_ROTH_401K, { hasEmployerMatch: true })] }),
    );
    expect(res.status).toBe('done'); // match flagged → "done", not "No retirement accounts"
  });

  it('a Roth 401k counts as "has a 401(k)" for the max-401k node', () => {
    const res = evaluateMax401k(
      makeContext({ accounts: [makeAccount(7, AccountType.ACCOUNT_ROTH_401K)] }),
    );
    expect(res.evidence).not.toMatch(/No 401\(k\) on file/);
  });

  it('a Roth 401k counts for the mega-backdoor "has a 401(k)" gate', () => {
    const res = evaluateAfterTax401kQ(
      makeContext({ accounts: [makeAccount(7, AccountType.ACCOUNT_ROTH_401K, { allowsMegaBackdoorRollover: null })] }),
    );
    expect(res.evidence).not.toMatch(/No 401\(k\) on file/);
  });
});
