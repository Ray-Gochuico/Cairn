import type { Account, Holding, Loan, LoanPayment, Transaction, Household } from '@/types/schema';

export interface AppSettingsSlice {
  defaultInflation: number;
  defaultReturnRate: number;
}

export interface RealStateInputs {
  accounts: Account[];
  holdings: Holding[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  transactions: Transaction[];
  household: Household;
  appSettings: AppSettingsSlice;
  startISO: string;
}

export interface RealState {
  accounts: Account[];
  holdings: Holding[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  household: Household;
  baselineMonthlyExpenses: number;
  defaults: { inflation: number; returnRate: number };
  startISO: string;
}

export function captureRealState(inputs: RealStateInputs): RealState {
  const baselineMonthlyExpenses = computeBaselineExpenses(inputs.transactions, inputs.startISO);
  return {
    accounts: inputs.accounts,
    holdings: inputs.holdings,
    loans: inputs.loans,
    loanPayments: inputs.loanPayments,
    household: inputs.household,
    baselineMonthlyExpenses,
    defaults: {
      inflation: inputs.appSettings.defaultInflation,
      returnRate: inputs.appSettings.defaultReturnRate,
    },
    startISO: inputs.startISO,
  };
}

function computeBaselineExpenses(transactions: Transaction[], startISO: string): number {
  const startMs = Date.parse(startISO);
  const horizonMs = 12 * 30 * 86_400_000;
  const recent = transactions.filter(
    (t) => t.amount < 0 && Date.parse(t.date) >= startMs - horizonMs && Date.parse(t.date) <= startMs,
  );
  if (recent.length === 0) return 0;
  const totalOutflow = recent.reduce((acc, t) => acc + Math.abs(t.amount), 0);
  const monthsObserved = new Set(recent.map((t) => t.date.slice(0, 7))).size;
  return totalOutflow / Math.max(monthsObserved, 1);
}
