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
});
