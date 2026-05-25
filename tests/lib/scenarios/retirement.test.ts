import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Holding, Loan, Household, Person } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import { ageAtMonth } from '@/lib/dates';

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: null, rate: 0.32 },
];

const household = {
  id: 1, filingStatus: 'SINGLE', state: 'TX', city: null,
  monthlyExpenseBaseline: 4500, withdrawalRate: 0.04,
  inflationAssumption: 0.025, growthScenarios: [],
} as unknown as Household;

// Person currently age 45 in 2026 (born 1981). Target retirement age 50.
// Engine starts in 2026-05, so retirement transition happens at age 50 → 2031-05.
// At startISO 2026-05, age is 45 (months: 0..59 = ages 45..49, month 60 = age 50).
const person45 = {
  id: 1, householdId: 1, name: 'P1',
  dateOfBirth: '1981-05-15',
  targetRetirementAge: 50,
  annualSalaryPretax: 135000,
} as unknown as Person;

const holdings: Holding[] = [];
const loans: Loan[] = [];

function makeRealState(
  overrides: Partial<Pick<RealState, 'persons' | 'initialCash' | 'initialInvestments' | 'baselineMonthlyExpenses'>> = {},
): RealState {
  return {
    accounts: [],
    holdings,
    loans,
    loanPayments: [],
    household,
    persons: [person45],
    baselineMonthlyExpenses: 4500,
    initialCash: 5000,
    initialInvestments: 500000,
    defaults: { inflation: 0, returnRate: 0.07 },
    startISO: '2026-05',
    taxBrackets: {
      federal: federal2026Single,
      state: [],
      city: null,
      standardDeduction: 14600,
    },
    ...overrides,
  };
}

describe('ageAtMonth', () => {
  it('returns full years between dob and the first day of the given month', () => {
    expect(ageAtMonth('1981-05-15', '2026-05')).toBe(44);
    // Birthday already passed in month → age increments at that month's start
    expect(ageAtMonth('1981-05-15', '2026-06')).toBe(45);
    expect(ageAtMonth('1981-05-15', '2031-05')).toBe(49);
    expect(ageAtMonth('1981-05-15', '2031-06')).toBe(50);
  });

  it('handles null/empty dob gracefully (returns 0)', () => {
    expect(ageAtMonth(null, '2026-05')).toBe(0);
    expect(ageAtMonth(undefined, '2026-05')).toBe(0);
    expect(ageAtMonth('', '2026-05')).toBe(0);
  });
});

describe('projectScenario — retirement age transition', () => {
  it('income drops to 0 once a person reaches their targetRetirementAge', () => {
    const real = makeRealState();
    const states = projectScenario(real, emptyLeverPayload(), { startISO: '2026-05', months: 120 });

    // Pre-retirement (5 years in, age 49-50): person still earning.
    expect(states[12].incomeAfterTax).toBeGreaterThan(0);

    // Post-retirement (month 60 = 2031-05, age turns 50 in 2031-06):
    // By month 70 they're firmly past targetRetirementAge → no salary.
    expect(states[70].incomeAfterTax).toBe(0);
    expect(states[119].incomeAfterTax).toBe(0);
  });

  it('post-retirement expenses are drawn from investments via the cash-floor rule', () => {
    // Hostile drawdown: 0% return + high expenses so the monthly post-retirement
    // deficit clearly erodes investments. With $4500/mo expenses and 0% return,
    // investments shrink by $54K/yr post-retirement.
    const realLowReturn: RealState = {
      ...makeRealState({ initialCash: 5000, initialInvestments: 500000 }),
      defaults: { inflation: 0, returnRate: 0 },
    };
    const payload = emptyLeverPayload();
    payload.returns = { defaultRate: 0, overrides: {} };
    const states = projectScenario(realLowReturn, payload, { startISO: '2026-05', months: 120 });

    // Pre-retirement (year 1): investments grow from savings (no return).
    expect(states[12].investments).toBeGreaterThan(states[0].investments);

    // Post-retirement, with no income, investments are eroded by expenses.
    expect(states[108].investments).toBeLessThan(states[70].investments);

    // Cash stays at zero through the drawdown.
    for (let i = 70; i < states.length; i++) {
      expect(states[i].cash).toBeGreaterThanOrEqual(0);
    }
  });

  it('LeverPayload.retirementAgeOverride takes precedence over Person.targetRetirementAge', () => {
    const real = makeRealState();
    const payload = emptyLeverPayload();
    payload.retirementAgeOverride = 65; // far higher than person's own targetRetirementAge=50

    const states = projectScenario(real, payload, { startISO: '2026-05', months: 240 });

    // At month 70 (age ~50), with override=65, person should STILL be earning.
    expect(states[70].incomeAfterTax).toBeGreaterThan(0);
    // At month 230 (age ~64.5), still earning.
    expect(states[230].incomeAfterTax).toBeGreaterThan(0);
    // At the end of horizon (month 239 = 2046-04, age ~64) — still pre-65.
    expect(states[239].incomeAfterTax).toBeGreaterThan(0);
  });

  it('two-person household: each person retires on their own schedule', () => {
    // P1 turns 50 at month 60 → retires (targetRetirementAge=50, dob=1981-05-15).
    // P2 currently age 30 (dob=1996-05-15), targetRetirementAge=65 → retires at month 60*7=420 (out of range).
    const person30 = {
      id: 2, householdId: 1, name: 'P2',
      dateOfBirth: '1996-05-15',
      targetRetirementAge: 65,
      annualSalaryPretax: 80000,
    } as unknown as Person;

    const real = makeRealState({ persons: [person45, person30] });
    const payload = emptyLeverPayload();
    payload.income.perPerson = [
      { annualRaiseRate: 0, events: [] },
      { annualRaiseRate: 0, events: [] },
    ];
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 84 });

    // Both earning at start (month 1): combined salaries.
    const incomeMonth1 = states[1].incomeAfterTax;
    expect(incomeMonth1).toBeGreaterThan(0);

    // After P1 retires (month ~62, age 50), only P2 earning → lower income.
    const incomeMonth70 = states[70].incomeAfterTax;
    expect(incomeMonth70).toBeGreaterThan(0);
    expect(incomeMonth70).toBeLessThan(incomeMonth1);
  });

  it('retirement age never reached within horizon: behaves identically to no-retirement', () => {
    // Set retirement age way above current age + horizon so it's never triggered.
    const real = makeRealState();
    const payload = emptyLeverPayload();
    payload.retirementAgeOverride = 89;
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 60 });
    for (let i = 1; i < states.length; i++) {
      expect(states[i].incomeAfterTax).toBeGreaterThan(0);
    }
  });
});
