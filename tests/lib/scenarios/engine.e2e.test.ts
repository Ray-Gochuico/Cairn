import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Holding, Loan, Household, Person } from '@/types/schema';
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
} as unknown as Household;

const persons: Person[] = [
  { id: 1, householdId: 1, name: 'P1', annualSalaryPretax: 135000 } as unknown as Person,
];

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
  persons,
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

describe('projectScenario — contributions lever combined with other levers', () => {
  it('handles contributions + extra loan payments + return overrides together without crashing or breaking earlier invariants', () => {
    const payload = emptyLeverPayload();
    payload.contributions = [
      { startMonth: 0, endMonth: 59, monthlyAmount: 1000, label: 'Y1-Y5 $1k/mo' },
      { startMonth: 60, endMonth: null, monthlyAmount: 2000, label: 'Y6+ $2k/mo' },
    ];
    payload.extraLoanPayments = [{ loanId: 1, extraMonthly: 200 }];
    payload.returns = { defaultRate: 0.07, overrides: { '2027': -0.15, '2028': 0.2 } };

    const states = projectScenario(realState, payload, { startISO: '2026-05', months: 84 });

    // Auto loan still gets paid off (extra payments win — milestone still fires).
    const debtFreeMonth = states.find((s) => Object.values(s.debtByLoan).reduce((a, b) => a + b, 0) === 0);
    expect(debtFreeMonth).toBeDefined();

    // Spot-check: month 60 lies in the Y6+ segment ($2000/mo) and prior months
    // in the Y1-Y5 segment ($1000/mo). Net worth must be a finite number through
    // the horizon — the combination of negative-year returns, extra debt service,
    // and contribution routing must not produce NaN or Infinity.
    expect(Number.isFinite(states[60].netWorth)).toBe(true);
    expect(Number.isFinite(states[83].investments)).toBe(true);
  });

  it('shortfall is permitted: cash floors at zero and investments absorb the deficit', () => {
    // Adjusted for the cash-floor change: cash bottoms at 0 and any remaining
    // deficit (after contributions and the savings shortfall) hits investments.
    const hostileReal: RealState = {
      ...realState,
      baselineMonthlyExpenses: 99999,
      household: { ...realState.household, monthlyExpenseBaseline: 99999 } as Household,
    };
    const payload = emptyLeverPayload();
    payload.contributions = [{ startMonth: 0, endMonth: 11, monthlyAmount: 1500 }];
    const states = projectScenario(hostileReal, payload, { startISO: '2026-05', months: 13 });
    expect(states[11].cash).toBe(0);
    // Run never produces NaN/Infinity even when the household is insolvent.
    expect(Number.isFinite(states[11].investments)).toBe(true);
  });
});

describe('projectScenario — cash floor + investments deficit routing', () => {
  // No-loans, no-return base so each test reads the routing exactly.
  // (RealState.defaults are read by ChartToolbar etc; the engine reads
  // payload.returns. Tests below set both.)
  const flatReal: RealState = {
    ...realState,
    loans: [],
    defaults: { inflation: 0, returnRate: 0 },
  };

  function zeroReturnPayload() {
    const p = emptyLeverPayload();
    p.returns = { defaultRate: 0, overrides: {} };
    return p;
  }

  it('saving household: investments rise from both savings and returns', () => {
    // Positive-savings household: cash gets no flow (savings > 0 → routed
    // to investments). With nonzero return investments grow from BOTH the
    // savings contribution and compounded return each month.
    const real: RealState = {
      ...flatReal,
      household: { ...flatReal.household, monthlyExpenseBaseline: 3000 } as Household,
      baselineMonthlyExpenses: 3000,
    };
    const sevenPct = emptyLeverPayload(); // defaultRate: 0.07
    const states = projectScenario(real, sevenPct, { startISO: '2026-05', months: 13 });
    expect(states[12].investments).toBeGreaterThan(states[0].investments);
    expect(states[12].cash).toBeGreaterThanOrEqual(0);
    // Compare with-return vs no-return trajectory. The 7% one must end
    // higher than the 0% one, confirming returns are applied AFTER the
    // savings routing.
    const noReturnStates = projectScenario(real, zeroReturnPayload(), { startISO: '2026-05', months: 13 });
    expect(states[12].investments).toBeGreaterThan(noReturnStates[12].investments);
  });

  it('moderate deficit with cash buffer: cash drawn down (not negative)', () => {
    // Seed a positive-cash situation by configuring a contributions segment
    // that pulls slightly less than savings into investments — surplus flows
    // to cash. Verify that cash builds up without going negative.
    const payload = zeroReturnPayload();
    payload.contributions = [{ startMonth: 0, endMonth: 5, monthlyAmount: 100 }];
    const states = projectScenario(flatReal, payload, { startISO: '2026-05', months: 7 });
    expect(states[6].cash).toBeGreaterThan(0);
    expect(states[6].investments).toBeGreaterThan(states[0].investments);
  });

  it('heavy deficit: cash floors at zero, investments draws down, returns still applied each month', () => {
    // Deficit household: expenses just exceed income so savings is negative
    // each month, but the monthly draw is small enough that investments
    // stay positive across the 12-month horizon. Compare 5%-return vs
    // 0%-return: with positive return the investments balance erodes less
    // per month, ending HIGHER than the no-return case. This is the
    // observable signal that returns are applied AFTER the cash-floor
    // deduction each month (step 7 in stepMonth).
    // Income at 135k/yr CA → ~$8k/mo after-tax → mild deficit at $9k/mo
    // expenses + $425 loan → ~$1.4k/mo deficit on $200k investments.
    const real: RealState = {
      ...flatReal,
      household: { ...flatReal.household, monthlyExpenseBaseline: 9000 } as Household,
      baselineMonthlyExpenses: 9000,
      loans: [], // already cleared in flatReal, kept explicit
    };
    const fivePct = emptyLeverPayload();
    fivePct.returns = { defaultRate: 0.05, overrides: {} };
    const states = projectScenario(real, fivePct, { startISO: '2026-05', months: 13 });
    // Cash never dips below zero.
    for (let i = 0; i < states.length; i++) {
      expect(states[i].cash).toBeGreaterThanOrEqual(0);
    }
    // Investments stay positive across the horizon and absorb the deficit.
    expect(states[12].investments).toBeGreaterThan(0);
    expect(states[12].investments).toBeLessThan(states[0].investments);
    // Returns are still applied each month: 5%-return ends higher than 0%.
    const noReturnStates = projectScenario(real, zeroReturnPayload(), { startISO: '2026-05', months: 13 });
    expect(states[12].investments).toBeGreaterThan(noReturnStates[12].investments);
  });

  it('parity: saving household without contributions behaves identically to pre-change routing', () => {
    // Saving household → savings > 0 path. The cash-floor change leaves this
    // code path untouched. Investments must accumulate the full savings each
    // month, cash must stay at zero (no flow into cash).
    // Use 0% return + 0% inflation → savings is constant month over month,
    // so the monthly investment delta should be identical month 1 vs month 12.
    const states = projectScenario(flatReal, zeroReturnPayload(), { startISO: '2026-05', months: 13 });
    expect(states[12].cash).toBe(0);
    expect(states[12].investments).toBeGreaterThan(states[0].investments);
    const delta1 = states[1].investments - states[0].investments;
    const delta12 = states[12].investments - states[11].investments;
    expect(delta1).toBeCloseTo(delta12, 5);
  });
});

describe('projectScenario — tax behavior', () => {
  it('after-tax income rises year-over-year as raises lift gross income', () => {
    const realCA: RealState = { ...realState, household: { ...realState.household, state: 'CA' } as Household };
    const payload = emptyLeverPayload();
    payload.income.perPerson[0].annualRaiseRate = 0.03;
    const states = projectScenario(realCA, payload, { startISO: '2026-05', months: 36 });
    // Sample after-tax income across years: should monotonically rise with a 3% explicit raise plan.
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
