import type { Account, Holding, Loan, LoanPayment, Transaction, Household, Person, TaxRule, JurisdictionType } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import type { FilingStatus } from '@/types/enums';
import { computeBaselineExpenses } from '@/lib/expense-baseline';

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
  persons: Person[];
  appSettings: AppSettingsSlice;
  startISO: string;
  taxRules: TaxRule[];
}

export interface RealStateTaxBrackets {
  federal: Bracket[];
  state: Bracket[];
  city: Bracket[] | null;
  standardDeduction: number;
}

export interface RealState {
  accounts: Account[];
  holdings: Holding[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  household: Household;
  persons: Person[];
  baselineMonthlyExpenses: number;
  defaults: { inflation: number; returnRate: number };
  startISO: string;
  taxBrackets: RealStateTaxBrackets;
}

function pickBrackets(
  rules: TaxRule[],
  jurisdictionType: JurisdictionType,
  jurisdictionCode: string,
  filingStatus: FilingStatus,
): Bracket[] {
  const match = rules.find(
    (r) =>
      r.jurisdictionType === jurisdictionType &&
      r.jurisdictionCode === jurisdictionCode &&
      r.filingStatus === filingStatus,
  );
  return match ? match.brackets : [];
}

function pickStandardDeduction(rules: TaxRule[], filingStatus: FilingStatus): number {
  const fed = rules.find(
    (r) => r.jurisdictionType === 'FEDERAL' && r.filingStatus === filingStatus,
  );
  return fed?.standardDeduction ?? 0;
}

export function captureRealState(inputs: RealStateInputs): RealState {
  const baselineMonthlyExpenses = computeBaselineExpenses(inputs.transactions, inputs.startISO);
  const filingStatus = inputs.household.filingStatus as FilingStatus;
  const state = (inputs.household as { state?: string | null }).state ?? null;
  const city = (inputs.household as { city?: string | null }).city ?? null;

  const federal = pickBrackets(inputs.taxRules, 'FEDERAL', 'US', filingStatus);
  const stateBrackets = state ? pickBrackets(inputs.taxRules, 'STATE', state, filingStatus) : [];
  const cityBrackets = city ? pickBrackets(inputs.taxRules, 'CITY', city, filingStatus) : [];

  const taxBrackets: RealStateTaxBrackets = {
    federal,
    state: stateBrackets,
    city: cityBrackets.length > 0 ? cityBrackets : null,
    standardDeduction: pickStandardDeduction(inputs.taxRules, filingStatus),
  };

  return {
    accounts: inputs.accounts,
    holdings: inputs.holdings,
    loans: inputs.loans,
    loanPayments: inputs.loanPayments,
    household: inputs.household,
    persons: inputs.persons,
    baselineMonthlyExpenses,
    defaults: {
      inflation: inputs.appSettings.defaultInflation,
      returnRate: inputs.appSettings.defaultReturnRate,
    },
    startISO: inputs.startISO,
    taxBrackets,
  };
}

