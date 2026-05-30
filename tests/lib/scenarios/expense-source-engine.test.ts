import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Household, Person } from '@/types/schema';

const household = {
  id: 1, filingStatus: 'SINGLE', state: 'TX', city: null,
  monthlyExpenseBaseline: 0, withdrawalRate: 0.04, inflationAssumption: 0.03, growthScenarios: [],
} as unknown as Household;
const persons: Person[] = [{ id: 1, householdId: 1, name: 'P1', annualSalaryPretax: 0 } as unknown as Person];

function realWithBasis(basis: { latestMonth: number; rolling12m: number }): RealState {
  return {
    accounts: [], holdings: [], loans: [], loanPayments: [], household, persons,
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 1_000_000, initialInvestmentsByAccount: {}, cashAccountsWithBalances: [],
    defaults: { inflation: 0.03, returnRate: 0, defaultCashApy: null, defaultDrawdownTaxRate: null },
    startISO: '2026-05',
    taxBrackets: { federal: [], state: [], city: null, ltcg: [], standardDeduction: { federal: 0, state: 0, city: 0 } },
    housingPayments: [], vehicleLeases: [],
    expenseBasis: basis,
  } as unknown as RealState;
}

describe('Feature B engine — base injection per mode', () => {
  it('custom mode uses customMonthly as the base', () => {
    const real = realWithBasis({ latestMonth: 9999, rolling12m: 8888 });
    const p = emptyLeverPayload();
    p.inflation = { defaultRate: 0, overrides: {} }; // factor=1 → expenses == base
    p.expenseSource = 'custom';
    p.customMonthly = 4000;
    const states = projectScenario(real, p, { startISO: '2026-05', months: 3 });
    expect(states[1].expenses).toBeCloseTo(4000, 6);
  });

  it('rolling12m mode reads RealState.expenseBasis.rolling12m', () => {
    const real = realWithBasis({ latestMonth: 9999, rolling12m: 3000 });
    const p = emptyLeverPayload();
    p.inflation = { defaultRate: 0, overrides: {} };
    p.expenseSource = 'rolling12m';
    const states = projectScenario(real, p, { startISO: '2026-05', months: 3 });
    expect(states[1].expenses).toBeCloseTo(3000, 6);
  });

  it('latestMonth mode reads RealState.expenseBasis.latestMonth', () => {
    const real = realWithBasis({ latestMonth: 2500, rolling12m: 9999 });
    const p = emptyLeverPayload();
    p.inflation = { defaultRate: 0, overrides: {} };
    p.expenseSource = 'latestMonth';
    const states = projectScenario(real, p, { startISO: '2026-05', months: 3 });
    expect(states[1].expenses).toBeCloseTo(2500, 6);
  });

  it('the base is ADDITIVE with active expense periods', () => {
    const real = realWithBasis({ latestMonth: 0, rolling12m: 2000 });
    const p = emptyLeverPayload();
    p.inflation = { defaultRate: 0, overrides: {} };
    p.expenseSource = 'rolling12m';
    p.expensePeriods = [{ start: '2026-05-01', monthlyDelta: 500, durationMonths: 480 }];
    const states = projectScenario(real, p, { startISO: '2026-05', months: 3 });
    expect(states[1].expenses).toBeCloseTo(2500, 6); // 2000 base + 500 period
  });

  it('the base INFLATES (grows month-over-month under positive inflation)', () => {
    const real = realWithBasis({ latestMonth: 0, rolling12m: 4000 });
    const p = emptyLeverPayload();
    p.inflation = { defaultRate: 0.12, overrides: {} }; // strong inflation → visible growth
    p.expenseSource = 'rolling12m';
    // months: 25 gives states[0..24]; states[24] is month-24 of the projection
    const states = projectScenario(real, p, { startISO: '2026-05', months: 25 });
    expect(states[24].expenses).toBeGreaterThan(states[1].expenses);
    // sanity: month-24 ≈ base * inflated factor — strictly > base.
    expect(states[24].expenses).toBeGreaterThan(4000);
  });
});
