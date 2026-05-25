import { describe, it, expect } from 'vitest';
import { captureRealState, type RealStateInputs } from '@/lib/scenarios/state-snapshot';
import type { Account, Holding, Loan, Transaction, Household } from '@/types/schema';

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

const inputs: RealStateInputs = {
  accounts,
  holdings,
  loans,
  loanPayments: [],
  transactions: [baseTx(1, '2026-04-15', -1500)],
  household,
  appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
  startISO: '2026-05-01',
};

describe('captureRealState', () => {
  it('returns a RealState with all input slices preserved', () => {
    const s = captureRealState(inputs);
    expect(s.holdings).toHaveLength(1);
    expect(s.loans[0].currentBalance).toBe(18400);
    expect(s.startISO).toBe('2026-05-01');
    expect(s.defaults.inflation).toBe(0.025);
  });

  it('computes baselineMonthlyExpenses as 12-month rolling avg from transactions', () => {
    const s = captureRealState({ ...inputs, transactions: [
      baseTx(1, '2026-04-15', -3000),
      baseTx(2, '2026-03-15', -3500),
      baseTx(3, '2026-02-15', -2800),
    ]});
    // Avg of (3000 + 3500 + 2800) / 3 = 3100 — only 3 months of data, so divide by months observed
    expect(s.baselineMonthlyExpenses).toBeCloseTo(3100, 0);
  });
});
