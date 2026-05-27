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

interface AutoInvestFactoryOverrides extends Partial<RealState> {
  /** No-op shim — `baselineMonthlyExpenses` removed in 2026-05-26 revamp;
   * tests now pass expenses via the lever's `expensePeriods` payload. */
  baselineMonthlyExpenses?: number;
}

function realStateFactory(overrides: AutoInvestFactoryOverrides = {}): RealState {
  const { baselineMonthlyExpenses: _legacy, ...rest } = overrides;
  void _legacy;
  return {
    accounts: [],
    holdings,
    loans: [],
    loanPayments: [],
    household,
    persons,
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0,
    initialInvestmentsByAccount: { 1: 200_000 },
    cashAccountsWithBalances: [],
    // currentMonthlySalarySurplus sums both routing destinations so the helper
    // is invariant to the setting; leaving it at the new default (false) here
    // confirms the cash branch reports the correct magnitude.
    defaults: {
      inflation: 0,
      returnRate: 0,
      defaultCashApy: null,
      autoInvestSalarySurplus: false,
    },
    startISO: '2026-05',
    taxBrackets: {
      federal: federal2026Single,
      state: [],
      city: null,
      standardDeduction: { federal: 14_600, state: 0, city: 0 },
    },
    ...rest,
  };
}

/** Apply the pre-revamp default $4500/mo expense baseline via payload. */
function withDefaultExpenses(payload: ReturnType<typeof emptyLeverPayload>) {
  payload.expensePeriods = [{ start: '2026-05-01', monthlyDelta: 4500, durationMonths: 480 }];
  return payload;
}

describe('currentMonthlySalarySurplus', () => {
  it('returns a positive number for a salaried household with positive monthly surplus', () => {
    const real = realStateFactory();
    const surplus = currentMonthlySalarySurplus(real, withDefaultExpenses(emptyLeverPayload()));
    // $135k/yr → ~$11.25k/mo gross → ~$8-9k/mo after tax → minus $4.5k expenses
    // → roughly $4-5k surplus. Exact figure depends on tax engine; we just
    // confirm the helper returns a sensible positive value.
    const amount = typeof surplus === 'number' ? surplus : surplus.amount;
    expect(amount).toBeGreaterThan(2_000);
    expect(amount).toBeLessThan(8_000);
  });

  it('returns 0 when expenses exceed income (no positive surplus to auto-invest)', () => {
    const zeroSalary = [{ ...persons[0], annualSalaryPretax: 0 } as Person];
    const real = realStateFactory({
      persons: zeroSalary,
    });
    const payload = emptyLeverPayload();
    payload.expensePeriods = [{ start: '2026-05-01', monthlyDelta: 5_000, durationMonths: 480 }];
    const surplus = currentMonthlySalarySurplus(real, payload);
    const amount = typeof surplus === 'number' ? surplus : surplus.amount;
    expect(amount).toBe(0);
  });

  it('IGNORES configured contribution segments — always reports the unsegmented surplus', () => {
    const real = realStateFactory();
    const payload = withDefaultExpenses(emptyLeverPayload());
    // Add a huge contribution segment — it must NOT affect the preview, since
    // the popover surfaces the "what would auto-invest" amount independent of
    // current segments.
    payload.contributions = [
      { startMonth: 0, endMonth: 59, monthlyAmount: 999_999, allocation: null },
    ];
    const surplus = currentMonthlySalarySurplus(real, payload);
    const amount = typeof surplus === 'number' ? surplus : surplus.amount;
    expect(amount).toBeGreaterThan(0);
    // Should match the no-segment baseline.
    const baseline = currentMonthlySalarySurplus(real, withDefaultExpenses(emptyLeverPayload()));
    const baselineAmount = typeof baseline === 'number' ? baseline : baseline.amount;
    expect(amount).toBeCloseTo(baselineAmount, 2);
  });

  it('reflects expense-period overrides from the lever payload', () => {
    const real = realStateFactory();
    const payload = withDefaultExpenses(emptyLeverPayload());
    // A negative monthlyDelta = an expense reduction, so surplus should grow.
    payload.expensePeriods = [
      ...payload.expensePeriods,
      { start: '2026-05-01', durationMonths: 60, monthlyDelta: -2_000, label: 'cut' },
    ];
    const surplus = currentMonthlySalarySurplus(real, payload);
    const baseline = currentMonthlySalarySurplus(real, withDefaultExpenses(emptyLeverPayload()));
    const amount = typeof surplus === 'number' ? surplus : surplus.amount;
    const baselineAmount = typeof baseline === 'number' ? baseline : baseline.amount;
    expect(amount).toBeGreaterThan(baselineAmount);
    expect(amount - baselineAmount).toBeCloseTo(2_000, 0);
  });

  it('reports the same magnitude regardless of autoInvestSalarySurplus setting', () => {
    // The helper surfaces the "magnitude of salary surplus" — invariant to
    // whether the engine routes it to investments (ON) or cash (OFF). It
    // sums both decomposition fields so the popover and pill show the same
    // number in either mode.
    const realOff = realStateFactory({
      defaults: {
        inflation: 0,
        returnRate: 0,
        defaultCashApy: null,
        autoInvestSalarySurplus: false,
      },
    });
    const realOn = realStateFactory({
      defaults: {
        inflation: 0,
        returnRate: 0,
        defaultCashApy: null,
        autoInvestSalarySurplus: true,
      },
    });
    const offSurplus = currentMonthlySalarySurplus(realOff, withDefaultExpenses(emptyLeverPayload()));
    const onSurplus = currentMonthlySalarySurplus(realOn, withDefaultExpenses(emptyLeverPayload()));
    const offAmount = typeof offSurplus === 'number' ? offSurplus : offSurplus.amount;
    const onAmount = typeof onSurplus === 'number' ? onSurplus : onSurplus.amount;
    expect(offAmount).toBeCloseTo(onAmount, 4);
    expect(offAmount).toBeGreaterThan(0);
  });
});
