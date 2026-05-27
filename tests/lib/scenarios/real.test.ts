import { describe, it, expect } from 'vitest';
import { toReal } from '@/lib/scenarios/real';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';
import type { MonthlyState } from '@/lib/scenarios/engine';

const make = (monthISO: string, invest: number): MonthlyState => ({
  monthISO,
  investmentsByAccount: { 1: invest },
  homeEquity: 0,
  cash: 0,
  debtByLoan: {},
  netWorth: invest,
  incomeAfterTax: 0,
  expenses: 0,
  savings: 0,
  events: [],
});

describe('toReal', () => {
  it('discounts dollar fields by inflation across years elapsed', () => {
    const states = [make('2026-05', 100000), make('2027-05', 100000)];
    const real = toReal(states, 0.025, '2026-05');
    expect(totalInvestments(real[0])).toBeCloseTo(100000, 0);
    expect(totalInvestments(real[1])).toBeCloseTo(100000 / 1.025, 0);
  });

  it('leaves debtByLoan as objects and discounts each entry', () => {
    const s: MonthlyState = { ...make('2027-05', 100000), debtByLoan: { 1: 50000 } };
    const real = toReal([s], 0.025, '2026-05');
    expect(real[0].debtByLoan[1]).toBeCloseTo(50000 / 1.025, 0);
  });

  it('does not mutate the input', () => {
    const states = [make('2027-05', 100000)];
    toReal(states, 0.025, '2026-05');
    expect(totalInvestments(states[0])).toBe(100000);
  });

  it('scales salarySurplusToCash by the inflation factor (Task α3)', () => {
    // Mirror the existing decomposition-field scaling: nominal $/step amounts
    // are deflated by the same per-step factor as cash / investments. After
    // 1 year @ 3% inflation, $1000 nominal ≈ $970.87 real (1 / 1.03).
    const states: MonthlyState[] = [
      { ...make('2026-05', 100_000), salarySurplusToCash: 0 },
      { ...make('2027-05', 100_000), salarySurplusToCash: 1000 },
    ];
    const realStates = toReal(states, 0.03, '2026-05');
    expect(realStates[1].salarySurplusToCash).toBeCloseTo(1000 / 1.03, 2);
    // Month 0 explicit zero stays at zero (preserved through the scale).
    expect(realStates[0].salarySurplusToCash).toBe(0);
  });

  it('preserves undefined salarySurplusToCash distinctly from 0', () => {
    // Seed state (month 0) doesn't step through stepMonth → field is undefined,
    // not 0. toReal must keep that distinction so tooltips don't render a row
    // for a state that never ran the auto-invest branch.
    const states: MonthlyState[] = [make('2027-05', 100_000)];
    const realStates = toReal(states, 0.03, '2026-05');
    expect(realStates[0].salarySurplusToCash).toBeUndefined();
  });
});
