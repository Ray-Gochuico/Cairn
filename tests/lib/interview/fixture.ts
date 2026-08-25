// Shared interview-test fixture (NOT a test file — review m8: exporting this
// from waterfall.test.ts re-registered that suite's tests in every importer,
// ~120 duplicated executions with muddied failure attribution).
import type { InterviewContext } from '@/types/interview';
import type { AccountSnapshot } from '@/types/schema';
import { AccountType } from '@/types/enums';
import { makeHousehold, makePerson, makeAccount, makeLoan } from '../../factories';

export const snap = (accountId: number, totalValue: number): AccountSnapshot =>
  ({ accountId, snapshotDate: '2026-07-30', totalValue } as AccountSnapshot);

export function fixtureCtx(overrides: Partial<InterviewContext> = {}): InterviewContext {
  return {
    household: makeHousehold({ monthlyExpenseBaseline: 6000 }),
    persons: [makePerson({ id: 1, jobStability: null })],
    accounts: [
      makeAccount({ id: 1, type: AccountType.ACCOUNT_SAVINGS, name: 'Savings' }),
      makeAccount({ id: 2, type: AccountType.ACCOUNT_CASH, name: 'Checking' }),
    ],
    snapshots: [snap(1, 22000), snap(2, 8000)],
    loans: [
      makeLoan({ id: 1, name: 'Mortgage', currentBalance: 540000, interestRate: 0.0625, monthlyPayment: 4001, termMonths: 360, firstPaymentDate: '2022-02-01' }),
      makeLoan({ id: 2, name: 'Visa', currentBalance: 3000, interestRate: 0.22, monthlyPayment: 150, termMonths: 36, firstPaymentDate: '2026-01-01' }),
      makeLoan({ id: 3, name: 'Car', currentBalance: 22000, interestRate: 0.049, monthlyPayment: 791, termMonths: 60, firstPaymentDate: '2025-02-01' }),
    ],
    contributions: [], transactions: [], categories: [], overrides: new Map(),
    thresholds: { low: 5, high: 8 }, taxYear: 2026,
    today: new Date('2026-08-01T12:00:00Z'),
    vehicles: [], assetValueSnapshots: [], settings: null, holdings: [], tickers: [],
    properties: [], housingPayments: [],
    interviewAnswers: new Map(),
    ...overrides,
  } as InterviewContext;
}
