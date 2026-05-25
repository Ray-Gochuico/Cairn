import { describe, it, expect } from 'vitest';
import {
  evaluateHighInterestDebt,
  evaluateModerateInterestDebt,
  evaluateLowInterestDebt,
} from '@/domain/roadmap/rules/debtClassification';
import type { RoadmapContext } from '@/types/roadmap';
import type { Loan, Household } from '@/types/schema';
import { FilingStatus, LoanType } from '@/types/enums';

function makeLoan(opts: { name?: string; rate: number; balance?: number }): Loan {
  return {
    id: Math.floor(Math.random() * 1e9),
    householdId: 1,
    obligorPersonId: null,
    name: opts.name ?? 'Loan',
    type: LoanType.PERSONAL,
    originalAmount: 10_000,
    currentBalance: opts.balance ?? 5_000,
    interestRate: opts.rate,  // stored as decimal (0.08 = 8%)
    monthlyPaymentMin: 100,
    startDate: '2024-01-01',
    payoffDate: null,
    isCurrent: true,
  } as Loan;
}

function makeHousehold(): Household {
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
  };
}

function makeContext(
  loans: Loan[],
  thresholds: { low: number; high: number } = { low: 5, high: 8 },
): RoadmapContext {
  return {
    household: makeHousehold(),
    persons: [],
    accounts: [],
    loans,
    contributions: [],
    snapshots: [],
    transactions: [],
    overrides: new Map(),
    thresholds,
    taxYear: 2026,
    today: new Date('2026-05-23T12:00:00Z'),
  };
}

describe('evaluateHighInterestDebt', () => {
  it('returns done when no loans exist', () => {
    const r = evaluateHighInterestDebt(makeContext([]));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/no active loans/i);
  });

  it('returns done when all loans are below the high threshold', () => {
    const r = evaluateHighInterestDebt(makeContext([
      makeLoan({ rate: 0.04 }),
      makeLoan({ rate: 0.06 }),
      makeLoan({ rate: 0.0799 }),
    ]));
    expect(r.status).toBe('done');
  });

  it('returns active when any loan crosses the high threshold (≥ 8% default)', () => {
    const r = evaluateHighInterestDebt(makeContext([
      makeLoan({ name: 'Credit Card', rate: 0.24 }),
    ]));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/Credit Card/);
    expect(r.evidence).toMatch(/24\.00%/);
    expect(r.cta?.href).toBe('/loans');
  });

  it('counts multiple offenders in the evidence string', () => {
    const r = evaluateHighInterestDebt(makeContext([
      makeLoan({ name: 'CC1', rate: 0.20 }),
      makeLoan({ name: 'CC2', rate: 0.15 }),
    ]));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/2 loans/);
    expect(r.evidence).toMatch(/CC1/);
    expect(r.evidence).toMatch(/CC2/);
  });

  it('ignores zero-balance loans (paid off)', () => {
    const r = evaluateHighInterestDebt(makeContext([
      makeLoan({ name: 'PaidCC', rate: 0.24, balance: 0 }),
    ]));
    expect(r.status).toBe('done');
  });

  it('honors per-household threshold overrides', () => {
    // Override the high threshold to 10%; a 9% loan is now moderate.
    const r = evaluateHighInterestDebt(
      makeContext([makeLoan({ rate: 0.09 })], { low: 5, high: 10 }),
    );
    expect(r.status).toBe('done');
  });
});

describe('evaluateModerateInterestDebt', () => {
  it('returns done when no loans fall in the moderate band', () => {
    const r = evaluateModerateInterestDebt(makeContext([
      makeLoan({ rate: 0.03 }),
      makeLoan({ rate: 0.20 }),
    ]));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/5–8%/);
  });

  it('returns active when a loan falls in [5%, 8%)', () => {
    const r = evaluateModerateInterestDebt(makeContext([
      makeLoan({ name: 'AutoLoan', rate: 0.07 }),
    ]));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/AutoLoan/);
  });

  it('5.00% is moderate; 4.99% is low; 8.00% is high (boundary check)', () => {
    expect(evaluateModerateInterestDebt(makeContext([makeLoan({ rate: 0.05 })])).status).toBe('active');
    expect(evaluateModerateInterestDebt(makeContext([makeLoan({ rate: 0.0499 })])).status).toBe('done');
    expect(evaluateModerateInterestDebt(makeContext([makeLoan({ rate: 0.08 })])).status).toBe('done');
  });
});

describe('evaluateLowInterestDebt', () => {
  it('returns done when no low-interest loans exist', () => {
    const r = evaluateLowInterestDebt(makeContext([
      makeLoan({ rate: 0.06 }),
      makeLoan({ rate: 0.20 }),
    ]));
    expect(r.status).toBe('done');
  });

  it('returns info (not active) for low-interest loans — it is a judgment call', () => {
    const r = evaluateLowInterestDebt(makeContext([
      makeLoan({ name: 'Mortgage', rate: 0.035 }),
    ]));
    expect(r.status).toBe('info');
    expect(r.evidence).toMatch(/Mortgage/);
    expect(r.evidence).toMatch(/3\.50%/);
  });

  it('singularises "1 loan" but pluralises "N loans"', () => {
    const single = evaluateLowInterestDebt(makeContext([
      makeLoan({ name: 'L1', rate: 0.02 }),
    ]));
    expect(single.evidence).toMatch(/1 low-interest loan/);
    const multiple = evaluateLowInterestDebt(makeContext([
      makeLoan({ name: 'L1', rate: 0.02 }),
      makeLoan({ name: 'L2', rate: 0.03 }),
    ]));
    expect(multiple.evidence).toMatch(/2 low-interest loans/);
  });
});
