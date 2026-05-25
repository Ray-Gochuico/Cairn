import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Holding, Loan, Household } from '@/types/schema';
import type { Bracket } from '@/lib/tax';

const holdings = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 1000, costBasis: 200, targetAllocationPct: null },
] as unknown as Holding[];

const loans = [
  { id: 1, householdId: 1, name: 'Auto', type: 'AUTO', currentBalance: 18400, interestRate: 0.059, monthlyPayment: 425, termMonths: 60 },
] as unknown as Loan[];

const household = {
  id: 1,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 4500,
  withdrawalRate: 0.04,
  inflationAssumption: 0.025,
  growthScenarios: [],
  persons: [{ id: 1, householdId: 1, name: 'P1', annualSalaryPretax: 135000 }],
} as unknown as Household & { persons: Array<{ id: number; annualSalaryPretax: number }> };

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: null, rate: 0.37 },
];

const caSingle: Bracket[] = [
  { min: 0, max: 10412, rate: 0.01 },
  { min: 10412, max: 24684, rate: 0.02 },
  { min: 24684, max: 38959, rate: 0.04 },
  { min: 38959, max: 54081, rate: 0.06 },
  { min: 54081, max: 68350, rate: 0.08 },
  { min: 68350, max: 349137, rate: 0.093 },
  { min: 349137, max: null, rate: 0.103 },
];

const realState: RealState = {
  accounts: [],
  holdings,
  loans,
  loanPayments: [],
  household,
  baselineMonthlyExpenses: 4500,
  defaults: { inflation: 0.025, returnRate: 0.07 },
  startISO: '2026-05',
  taxBrackets: {
    federal: federal2026Single,
    state: caSingle,
    city: null,
    standardDeduction: 14600,
  },
};

describe('projectScenario (end-to-end)', () => {
  it('produces one MonthlyState per month for the requested horizon', () => {
    const states = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 60 });
    expect(states).toHaveLength(60);
    expect(states[0].monthISO).toBe('2026-05');
    expect(states[59].monthISO).toBe('2031-04');
  });

  it('investments compound under the default 7% return when no overrides are set', () => {
    const states = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 13 });
    const inv0 = states[0].investments;
    const inv12 = states[12].investments;
    expect(inv12).toBeGreaterThan(inv0);
  });

  it('debt-free milestone fires when extra payments accelerate the auto loan', () => {
    const payload = emptyLeverPayload();
    payload.extraLoanPayments = [{ loanId: 1, extraMonthly: 300 }];
    const states = projectScenario(realState, payload, { startISO: '2026-05', months: 60 });
    const debtFreeMonth = states.find((s) => Object.values(s.debtByLoan).reduce((a, b) => a + b, 0) === 0);
    expect(debtFreeMonth).toBeDefined();
    // Compare against no-extra trajectory: must hit zero earlier
    const baseline = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 60 });
    const baselineDebtFree = baseline.find((s) => Object.values(s.debtByLoan).reduce((a, b) => a + b, 0) === 0);
    expect(debtFreeMonth!.monthISO < (baselineDebtFree?.monthISO ?? '9999-99')).toBe(true);
  });
});

describe('projectScenario — tax behavior', () => {
  it('after-tax income rises year-over-year as raises lift gross income', () => {
    const realCA: RealState = { ...realState, household: { ...realState.household, state: 'CA' } as Household };
    const states = projectScenario(realCA, emptyLeverPayload(), { startISO: '2026-05', months: 36 });
    // Sample after-tax income across years: should monotonically rise as salary grows by 3%/year default raise.
    const month0  = states[0].incomeAfterTax;
    const month12 = states[12].incomeAfterTax;
    const month24 = states[24].incomeAfterTax;
    expect(month12).toBeGreaterThan(month0);
    expect(month24).toBeGreaterThan(month12);
  });

  it('CA household pays more tax than TX household at the same gross income', () => {
    const realCA: RealState = {
      ...realState,
      household: { ...realState.household, state: 'CA' } as Household,
      taxBrackets: { federal: federal2026Single, state: caSingle, city: null, standardDeduction: 14600 },
    };
    const realTX: RealState = {
      ...realState,
      household: { ...realState.household, state: 'TX' } as Household,
      taxBrackets: { federal: federal2026Single, state: [], city: null, standardDeduction: 14600 },
    };
    const caAfter12 = projectScenario(realCA, emptyLeverPayload(), { startISO: '2026-05', months: 13 });
    const txAfter12 = projectScenario(realTX, emptyLeverPayload(), { startISO: '2026-05', months: 13 });
    // CA pays state tax; TX does not → CA's after-tax monthly income must be lower
    expect(caAfter12[12].incomeAfterTax).toBeLessThan(txAfter12[12].incomeAfterTax);
  });
});
