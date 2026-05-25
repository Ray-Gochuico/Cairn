import { describe, it, expect } from 'vitest';
import { applyAnnualReturn, monthlyReturnFromAnnual } from '@/lib/scenarios/apply-real';
import type { MonthlyState } from '@/lib/scenarios/engine';

const seed = (overrides: Partial<MonthlyState> = {}): MonthlyState => ({
  monthISO: '2027-01', investments: 100000, homeEquity: 0, cash: 0,
  debtByLoan: {}, netWorth: 100000, incomeAfterTax: 0, expenses: 0, savings: 0, events: [],
  ...overrides,
});

describe('monthlyReturnFromAnnual', () => {
  it('converts 12% annual to ~0.949% monthly (compounded)', () => {
    expect(monthlyReturnFromAnnual(0.12)).toBeCloseTo(0.00949, 4);
  });
  it('handles negative annual returns', () => {
    expect(monthlyReturnFromAnnual(-0.15)).toBeCloseTo(-0.01345, 4);
  });
});

describe('applyAnnualReturn', () => {
  it('grows investments by the monthly-compounded return', () => {
    const next = applyAnnualReturn(seed({ investments: 100000 }), 0.12);
    expect(next.investments).toBeCloseTo(100000 * 1.00949, 0);
  });
  it('does not touch cash, debt, or home equity', () => {
    const next = applyAnnualReturn(seed({ investments: 50000, cash: 10000, homeEquity: 300000, debtByLoan: { 1: 200000 } }), 0.07);
    expect(next.cash).toBe(10000);
    expect(next.homeEquity).toBe(300000);
    expect(next.debtByLoan[1]).toBe(200000);
  });
});
