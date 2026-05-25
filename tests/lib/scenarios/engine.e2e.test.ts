import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Holding, Loan, Household } from '@/types/schema';

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

const realState: RealState = {
  accounts: [],
  holdings,
  loans,
  loanPayments: [],
  household,
  baselineMonthlyExpenses: 4500,
  defaults: { inflation: 0.025, returnRate: 0.07 },
  startISO: '2026-05',
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
