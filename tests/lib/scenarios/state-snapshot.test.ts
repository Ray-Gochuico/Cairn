import { describe, it, expect } from 'vitest';
import { captureRealState, type RealStateInputs } from '@/lib/scenarios/state-snapshot';
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
    expect(s.taxBrackets.standardDeduction).toBe(14600);
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

describe('captureRealState — autoInvestSalarySurplus default', () => {
  it('threads autoInvestSalarySurplus=true into RealState.defaults', () => {
    const s = captureRealState({
      ...inputs,
      appSettings: { ...inputs.appSettings, autoInvestSalarySurplus: true },
    });
    expect(s.defaults.autoInvestSalarySurplus).toBe(true);
  });

  it('threads autoInvestSalarySurplus=false into RealState.defaults', () => {
    const s = captureRealState({
      ...inputs,
      appSettings: { ...inputs.appSettings, autoInvestSalarySurplus: false },
    });
    expect(s.defaults.autoInvestSalarySurplus).toBe(false);
  });

  it('defaults to false when appSettings.autoInvestSalarySurplus is undefined', () => {
    // The existing AppSettingsSlice fixture omits autoInvestSalarySurplus; the
    // captureRealState helper should treat that as false (the default).
    const s = captureRealState(inputs);
    expect(s.defaults.autoInvestSalarySurplus).toBe(false);
  });
});
