import { describe, it, expect } from 'vitest';
import { captureRealState, type RealStateInputs } from '@/lib/scenarios/state-snapshot';
import { computeTotalTax } from '@/lib/tax';
import type { Account, Holding, Loan, Transaction, Household, TaxRule } from '@/types/schema';
import { AccountType } from '@/types/enums';

const household = {
  id: 1,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 4500,
  withdrawalRate: 0.04,
  inflationAssumption: 0.025,
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
} as unknown as Household;

const accounts = [
  { id: 1, householdId: 1, name: 'Brokerage', type: 'ACCOUNT_BROKERAGE' },
] as unknown as Account[];

const holdings = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 100, costBasis: 200, targetAllocationPct: null },
] as unknown as Holding[];

const loans = [
  { id: 1, householdId: 1, name: 'Auto', type: 'AUTO', currentBalance: 18400, interestRate: 0.059, monthlyPayment: 425, termMonths: 60 },
] as unknown as Loan[];

const baseTx = (id: number, date: string, amount: number): Transaction =>
  ({ id, householdId: 1, date, amount, merchant: 'X', merchantRaw: null, categoryId: 5, sourceAccountId: 2 } as unknown as Transaction);

// Adjusted for the expense-sign fix: Transaction amounts use the schema
// convention (amount > 0 = purchase/expense). Fixture amounts here used to
// be negative before the sign correction landed in expense-baseline.ts.
const inputs: RealStateInputs = {
  accounts,
  holdings,
  loans,
  loanPayments: [],
  transactions: [baseTx(1, '2026-04-15', 1500)],
  household,
  persons: [],
  appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
  startISO: '2026-05-01',
  taxRules: [],
};

describe('captureRealState', () => {
  it('returns a RealState with all input slices preserved', () => {
    const s = captureRealState(inputs);
    expect(s.holdings).toHaveLength(1);
    expect(s.loans[0].currentBalance).toBe(18400);
    expect(s.startISO).toBe('2026-05-01');
    expect(s.defaults.inflation).toBe(0.025);
  });

  it('no longer exposes baselineMonthlyExpenses on the returned state', () => {
    const s = captureRealState({ ...inputs, transactions: [
      baseTx(1, '2026-04-15', 3000),
      baseTx(2, '2026-03-15', 3500),
      baseTx(3, '2026-02-15', 2800),
    ]});
    // Per the 2026-05-26 revamp the engine no longer reads a transaction-derived
    // baseline. The field is removed from RealState.
    expect((s as Record<string, unknown>).baselineMonthlyExpenses).toBeUndefined();
  });
});

describe('captureRealState — accountsByBucket', () => {
  it('groups accounts by tax bucket using taxBucketForAccount', () => {
    const multiAccounts = [
      { id: 1,  householdId: 1, name: 'Checking', type: AccountType.ACCOUNT_CASH,      excludedFromNetWorth: false },
      { id: 2,  householdId: 1, name: 'Savings',  type: AccountType.ACCOUNT_SAVINGS,   excludedFromNetWorth: false },
      { id: 10, householdId: 1, name: '401k',     type: AccountType.ACCOUNT_401K,     excludedFromNetWorth: false },
      { id: 11, householdId: 1, name: 'Roth IRA', type: AccountType.ACCOUNT_ROTH_IRA, excludedFromNetWorth: false },
      { id: 20, householdId: 1, name: 'Vanguard', type: AccountType.ACCOUNT_BROKERAGE, excludedFromNetWorth: false },
    ] as unknown as Account[];
    const s = captureRealState({ ...inputs, accounts: multiAccounts });
    expect(s.accountsByBucket.taxAdvantaged.map((a) => a.id).sort()).toEqual([10, 11]);
    expect(s.accountsByBucket.brokerage.map((a) => a.id)).toEqual([20]);
    expect(s.accountsByBucket.cash.map((a) => a.id).sort()).toEqual([1, 2]);
  });

  it('excludes accounts marked excludedFromNetWorth', () => {
    const multiAccounts = [
      { id: 10, householdId: 1, name: '401k', type: AccountType.ACCOUNT_401K, excludedFromNetWorth: true },
      { id: 20, householdId: 1, name: 'Brk',  type: AccountType.ACCOUNT_BROKERAGE, excludedFromNetWorth: false },
    ] as unknown as Account[];
    const s = captureRealState({ ...inputs, accounts: multiAccounts });
    expect(s.accountsByBucket.taxAdvantaged).toEqual([]);
    expect(s.accountsByBucket.brokerage.map((a) => a.id)).toEqual([20]);
  });
});

describe('captureRealState — tax brackets', () => {
  const federalRule: TaxRule = {
    year: 2026,
    jurisdictionType: 'FEDERAL',
    jurisdictionCode: 'US',
    filingStatus: 'SINGLE',
    brackets: [
      { min: 0, max: 11600, rate: 0.10 },
      { min: 11600, max: 47150, rate: 0.12 },
    ],
    standardDeduction: 14600,
  };
  const caRule: TaxRule = {
    year: 2026,
    jurisdictionType: 'STATE',
    jurisdictionCode: 'CA',
    filingStatus: 'SINGLE',
    brackets: [{ min: 0, max: 10412, rate: 0.01 }],
    standardDeduction: 5363,
  };

  it('parses bracket arrays and exposes federal + state + city + standardDeduction', () => {
    const s = captureRealState({
      ...inputs,
      taxRules: [federalRule, caRule],
    });
    expect(s.taxBrackets.federal.length).toBeGreaterThan(0);
    expect(s.taxBrackets.federal[0].rate).toBeCloseTo(0.10, 4);
    expect(s.taxBrackets.state.length).toBeGreaterThan(0);
    expect(s.taxBrackets.city).toBeNull();
    // Per-jurisdiction SD lookup (Task 2): federal $14,600 + CA $5,363.
    expect(s.taxBrackets.standardDeduction).toEqual({ federal: 14600, state: 5363, city: 0 });
  });

  it('falls back to empty brackets when no rule matches the household (TX no-state-tax case)', () => {
    const s = captureRealState({
      ...inputs,
      household: { ...inputs.household, state: 'TX' } as Household,
      taxRules: [federalRule],
    });
    expect(s.taxBrackets.federal.length).toBeGreaterThan(0);
    expect(s.taxBrackets.state).toEqual([]);
    expect(s.taxBrackets.city).toBeNull();
  });
});

describe('captureRealState — autoInvestSalarySurplus removed (2026-05-26 revamp)', () => {
  it('does not expose autoInvestSalarySurplus on RealState.defaults', () => {
    const s = captureRealState(inputs);
    expect((s.defaults as Record<string, unknown>).autoInvestSalarySurplus).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Per-jurisdiction standard deductions (Task 2, P0 #3).
//
// Pre-fix: state tax was computed against the federal standard deduction —
// a Massachusetts household at $300k MFJ was getting $32,200 SD applied to
// MA's bracket (MA SD = $0), under-collecting state tax by ~$1,460/year.
// California single at $200k was getting federal $16,100 instead of CA's
// per-filer SD, under-collecting state tax there too.
//
// Post-fix: RealStateTaxBrackets.standardDeduction is { federal, state, city }
// with values pulled from each jurisdiction's own tax_rules row.
// -----------------------------------------------------------------------------
describe('captureRealState — per-jurisdiction standard deductions', () => {
  const fedMFJ: TaxRule = {
    year: 2026,
    jurisdictionType: 'FEDERAL',
    jurisdictionCode: 'US',
    filingStatus: 'MFJ',
    brackets: [{ min: 0, max: null, rate: 0.22 }],
    standardDeduction: 32200,
  };
  const fedSingle: TaxRule = {
    year: 2026,
    jurisdictionType: 'FEDERAL',
    jurisdictionCode: 'US',
    filingStatus: 'SINGLE',
    brackets: [{ min: 0, max: null, rate: 0.22 }],
    standardDeduction: 16100,
  };
  const maMFJ: TaxRule = {
    year: 2026,
    jurisdictionType: 'STATE',
    jurisdictionCode: 'MA',
    filingStatus: 'MFJ',
    brackets: [{ min: 0, max: null, rate: 0.05 }],
    standardDeduction: 0, // MA has no state SD
  };
  const caSingle: TaxRule = {
    year: 2026,
    jurisdictionType: 'STATE',
    jurisdictionCode: 'CA',
    filingStatus: 'SINGLE',
    brackets: [{ min: 0, max: null, rate: 0.05 }],
    standardDeduction: 5540, // CA single 2026
  };
  const nycMFJ: TaxRule = {
    year: 2026,
    jurisdictionType: 'CITY',
    jurisdictionCode: 'NYC',
    filingStatus: 'MFJ',
    brackets: [{ min: 0, max: null, rate: 0.0388 }],
    standardDeduction: 0, // NYC has no city SD
  };

  it('MA MFJ household — state SD is 0 (not federal $32,200)', () => {
    const s = captureRealState({
      ...inputs,
      household: { ...inputs.household, filingStatus: 'MFJ', state: 'MA', city: null } as Household,
      taxRules: [fedMFJ, maMFJ],
    });
    expect(s.taxBrackets.standardDeduction).toEqual({
      federal: 32200,
      state: 0,
      city: 0,
    });
  });

  it('CA SINGLE household — state SD is $5,540 (not federal $16,100)', () => {
    const s = captureRealState({
      ...inputs,
      household: { ...inputs.household, filingStatus: 'SINGLE', state: 'CA', city: null } as Household,
      taxRules: [fedSingle, caSingle],
    });
    expect(s.taxBrackets.standardDeduction).toEqual({
      federal: 16100,
      state: 5540,
      city: 0,
    });
  });

  it('FL household — no state tax → state SD is 0', () => {
    const s = captureRealState({
      ...inputs,
      household: { ...inputs.household, filingStatus: 'SINGLE', state: 'FL', city: null } as Household,
      taxRules: [fedSingle],
    });
    expect(s.taxBrackets.standardDeduction).toEqual({
      federal: 16100,
      state: 0,
      city: 0,
    });
  });

  it('end-to-end: MA MFJ at $300k → state tax = $15,000 (5% × $300k, no SD applied)', () => {
    // Concrete example from the Finance review (finding #2).
    // Pre-fix: state tax used $32,200 federal SD → MA tax = $13,540
    //          (under-collected by ~$1,460/year).
    // Post-fix: state SD = $0 (MA's actual rule) → MA tax = $15,000.
    const s = captureRealState({
      ...inputs,
      household: { ...inputs.household, filingStatus: 'MFJ', state: 'MA', city: null } as Household,
      taxRules: [fedMFJ, maMFJ],
    });
    const out = computeTotalTax({
      gross: 300000,
      filingStatus: 'MFJ',
      federalBrackets: s.taxBrackets.federal,
      stateBrackets: s.taxBrackets.state,
      cityBrackets: s.taxBrackets.city,
      standardDeduction: s.taxBrackets.standardDeduction,
      pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
    });
    expect(out.state).toBeCloseTo(15000, 0);
  });

  it('NYC MFJ household — city SD is 0 (NYC has no city SD)', () => {
    const s = captureRealState({
      ...inputs,
      household: { ...inputs.household, filingStatus: 'MFJ', state: 'MA', city: 'NYC' } as Household,
      taxRules: [fedMFJ, maMFJ, nycMFJ],
    });
    expect(s.taxBrackets.standardDeduction).toEqual({
      federal: 32200,
      state: 0,
      city: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Task 4 — Feature B: expenseBasis precompute at capture
// ---------------------------------------------------------------------------

import { latestCompleteMonthBaseline, rolling12mBaseline } from '@/lib/expense-baseline';
import type { Category } from '@/types/schema';

describe('captureRealState — Feature B expenseBasis precompute', () => {
  it('computes latestMonth + rolling12m from transactions, real-spending-filtered', () => {
    const categories = [
      { id: 1, name: 'Groceries', parentCategoryId: null, color: null, icon: null, type: 'EXPENSE', isCapital: false, systemManaged: false, monthlyBudget: null },
      { id: 2, name: 'Move', parentCategoryId: null, color: null, icon: null, type: 'TRANSFER', isCapital: false, systemManaged: false, monthlyBudget: null },
    ] as never as Category[];
    const transactions = [
      { id: 1, householdId: 1, date: '2026-04-10', amount: 3000, merchant: 'M', merchantRaw: null, categoryId: 1, sourceAccountId: 1 },
      { id: 2, householdId: 1, date: '2026-03-10', amount: 2000, merchant: 'M', merchantRaw: null, categoryId: 1, sourceAccountId: 1 },
      { id: 3, householdId: 1, date: '2026-04-15', amount: 9999, merchant: 'X', merchantRaw: null, categoryId: 2, sourceAccountId: 1 }, // transfer → excluded
    ] as never as Transaction[];

    const real = captureRealState({
      accounts: [], holdings: [], loans: [], loanPayments: [],
      household: { filingStatus: 'SINGLE', state: 'TX', city: null, monthlyExpenseBaseline: 0, withdrawalRate: 0.04, inflationAssumption: 0.03, growthScenarios: [] } as never as Household,
      persons: [], appSettings: { defaultInflation: 0.03, defaultReturnRate: 0.05, defaultCashApy: null, defaultDrawdownTaxRate: null },
      startISO: '2026-05', taxRules: [],
      transactions, categories,
    });

    expect(real.expenseBasis.latestMonth).toBe(latestCompleteMonthBaseline(transactions, categories, '2026-05'));
    expect(real.expenseBasis.latestMonth).toBeCloseTo(3000, 0); // April, transfer excluded
    expect(real.expenseBasis.rolling12m).toBe(rolling12mBaseline(transactions, categories, '2026-05'));
    expect(real.expenseBasis.rolling12m).toBeCloseTo(2500, 0); // (3000 + 2000) / 2 months
  });

  it('defaults expenseBasis to {0,0} when there are no transactions', () => {
    const real = captureRealState({
      accounts: [], holdings: [], loans: [], loanPayments: [],
      household: { filingStatus: 'SINGLE', state: 'TX', city: null, monthlyExpenseBaseline: 0, withdrawalRate: 0.04, inflationAssumption: 0.03, growthScenarios: [] } as never as Household,
      persons: [], appSettings: { defaultInflation: 0.03, defaultReturnRate: 0.05, defaultCashApy: null, defaultDrawdownTaxRate: null },
      startISO: '2026-05', taxRules: [],
      transactions: [], categories: [],
    });
    expect(real.expenseBasis).toEqual({ latestMonth: 0, rolling12m: 0 });
  });
});
