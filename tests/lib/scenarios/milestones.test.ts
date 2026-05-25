import { describe, it, expect } from 'vitest';
import { detectMilestones, type FireParams } from '@/lib/scenarios/milestones';
import type { MonthlyState } from '@/lib/scenarios/engine';

function buildStates(values: Array<{ month: string; netWorth: number; debt: number; expenses: number }>): MonthlyState[] {
  return values.map((v) => ({
    monthISO: v.month, investments: v.netWorth + v.debt, homeEquity: 0, cash: 0,
    debtByLoan: v.debt > 0 ? { 1: v.debt } : {},
    netWorth: v.netWorth, incomeAfterTax: 0, expenses: v.expenses, savings: 0, events: [],
  }));
}

describe('detectMilestones', () => {
  const fireParams: FireParams = { withdrawalRate: 0.04 };

  it('finds debt-free month (first month with zero total debt)', () => {
    const states = buildStates([
      { month: '2026-05', netWorth: 100000, debt: 18000, expenses: 4000 },
      { month: '2026-06', netWorth: 102000, debt: 17000, expenses: 4000 },
      { month: '2029-06', netWorth: 220000, debt: 0,     expenses: 4000 },
    ]);
    expect(detectMilestones(states, fireParams).debtFreeISO).toBe('2029-06');
  });

  it('finds FIRE month (first month where net worth × withdrawalRate / 12 ≥ monthly expenses)', () => {
    const states = buildStates([
      { month: '2030-01', netWorth: 500000,  debt: 0, expenses: 4000 },
      { month: '2035-01', netWorth: 1100000, debt: 0, expenses: 4000 },
      { month: '2040-01', netWorth: 1300000, debt: 0, expenses: 4000 },
    ]);
    // 4% of 1.1M = 44K/yr = 3,666/mo < 4000 expenses; 4% of 1.3M = 52K/yr = 4,333/mo ≥ 4000
    expect(detectMilestones(states, fireParams).fireISO).toBe('2040-01');
  });

  it('returns undefined fields when milestones are never reached', () => {
    const states = buildStates([
      { month: '2026-05', netWorth: 100000, debt: 18000, expenses: 4000 },
      { month: '2056-05', netWorth: 110000, debt: 12000, expenses: 4000 },
    ]);
    expect(detectMilestones(states, fireParams)).toEqual({ debtFreeISO: undefined, fireISO: undefined });
  });
});
