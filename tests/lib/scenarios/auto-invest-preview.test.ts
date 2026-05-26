import { describe, it, expect } from 'vitest';
import { currentMonthlySalarySurplus } from '@/lib/scenarios/auto-invest-preview';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Holding, Household, Person } from '@/types/schema';
import type { Bracket } from '@/lib/tax';

const holdings = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 1000, costBasis: 200, targetAllocationPct: null },
] as unknown as Holding[];

const household = {
  id: 1, filingStatus: 'SINGLE', state: 'TX', city: null,
  monthlyExpenseBaseline: 4500, withdrawalRate: 0.04,
  inflationAssumption: 0, growthScenarios: [],
} as unknown as Household;

const persons: Person[] = [
  { id: 1, householdId: 1, name: 'P1', annualSalaryPretax: 135_000 } as unknown as Person,
];

const federal2026Single: Bracket[] = [
  { min: 0, max: 11_600, rate: 0.10 },
  { min: 11_600, max: 47_150, rate: 0.12 },
  { min: 47_150, max: 100_525, rate: 0.22 },
  { min: 100_525, max: 191_950, rate: 0.24 },
  { min: 191_950, max: 243_725, rate: 0.32 },
  { min: 243_725, max: 609_350, rate: 0.35 },
  { min: 609_350, max: null, rate: 0.37 },
];

function realStateFactory(overrides: Partial<RealState> = {}): RealState {
  return {
    accounts: [],
    holdings,
    loans: [],
    loanPayments: [],
    household,
    persons,
    baselineMonthlyExpenses: 4500,
    initialCash: 0,
    initialInvestmentsByAccount: { 1: 200_000 },
    cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null },
    startISO: '2026-05',
    taxBrackets: {
      federal: federal2026Single,
      state: [],
      city: null,
      standardDeduction: 14_600,
    },
    ...overrides,
  };
}

describe('currentMonthlySalarySurplus', () => {
  it('returns a positive number for a salaried household with positive monthly surplus', () => {
    const real = realStateFactory();
    const surplus = currentMonthlySalarySurplus(real, emptyLeverPayload());
    // $135k/yr → ~$11.25k/mo gross → ~$8-9k/mo after tax → minus $4.5k expenses
    // → roughly $4-5k surplus. Exact figure depends on tax engine; we just
    // confirm the helper returns a sensible positive value.
    expect(surplus).toBeGreaterThan(2_000);
    expect(surplus).toBeLessThan(8_000);
  });

  it('returns 0 when expenses exceed income (no positive surplus to auto-invest)', () => {
    const zeroSalary = [{ ...persons[0], annualSalaryPretax: 0 } as Person];
    const real = realStateFactory({
      persons: zeroSalary,
      baselineMonthlyExpenses: 5_000,
    });
    const surplus = currentMonthlySalarySurplus(real, emptyLeverPayload());
    expect(surplus).toBe(0);
  });

  it('IGNORES configured contribution segments — always reports the unsegmented surplus', () => {
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    // Add a huge contribution segment — it must NOT affect the preview, since
    // the popover surfaces the "what would auto-invest" amount independent of
    // current segments.
    payload.contributions = [
      { startMonth: 0, endMonth: 59, monthlyAmount: 999_999, allocation: null },
    ];
    const surplus = currentMonthlySalarySurplus(real, payload);
    expect(surplus).toBeGreaterThan(0);
    // Should match the no-segment baseline.
    const baseline = currentMonthlySalarySurplus(real, emptyLeverPayload());
    expect(surplus).toBeCloseTo(baseline, 2);
  });

  it('reflects expense-period overrides from the lever payload', () => {
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    // A negative monthlyDelta = an expense reduction, so surplus should grow.
    payload.expensePeriods = [
      { start: '2026-05', durationMonths: 60, monthlyDelta: -2_000, label: 'cut' },
    ];
    const surplus = currentMonthlySalarySurplus(real, payload);
    const baseline = currentMonthlySalarySurplus(real, emptyLeverPayload());
    expect(surplus).toBeGreaterThan(baseline);
    expect(surplus - baseline).toBeCloseTo(2_000, 0);
  });
});
