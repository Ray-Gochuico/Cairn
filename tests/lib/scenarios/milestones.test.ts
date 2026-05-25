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
    const m = detectMilestones(states, fireParams);
    expect(m.debtFreeISO).toBeUndefined();
    expect(m.fireISO).toBeUndefined();
  });

  it('reports netWorth30y as the net worth at month index 359 when the horizon is at least 360 months', () => {
    const states: MonthlyState[] = [];
    for (let i = 0; i < 400; i++) {
      states.push({
        monthISO: '2026-01',
        investments: 0,
        homeEquity: 0,
        cash: 0,
        debtByLoan: {},
        netWorth: 1000 + i,
        incomeAfterTax: 0,
        expenses: 0,
        savings: 0,
        events: [],
      });
    }
    expect(detectMilestones(states, fireParams).netWorth30y).toBe(1000 + 359);
  });

  it('falls back to the final state net worth when fewer than 30 years of states are available', () => {
    const states = buildStates([
      { month: '2026-05', netWorth: 100000, debt: 0, expenses: 4000 },
      { month: '2026-06', netWorth: 200000, debt: 0, expenses: 4000 },
    ]);
    expect(detectMilestones(states, fireParams).netWorth30y).toBe(200000);
  });

  it('returns undefined netWorth30y when given an empty state list', () => {
    expect(detectMilestones([], fireParams).netWorth30y).toBeUndefined();
  });

  it('detects the retirement month (first month where incomeAfterTax transitions to 0)', () => {
    const states: MonthlyState[] = [
      { monthISO: '2026-05', investments: 0, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 8000, expenses: 4000, savings: 4000, events: [] },
      { monthISO: '2026-06', investments: 0, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 8000, expenses: 4000, savings: 4000, events: [] },
      { monthISO: '2031-06', investments: 0, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 0,    expenses: 4000, savings: -4000, events: [] },
      { monthISO: '2031-07', investments: 0, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 0,    expenses: 4000, savings: -4000, events: [] },
    ];
    expect(detectMilestones(states, fireParams).retirementISO).toBe('2031-06');
  });

  it('returns undefined retirementISO when income never transitions to zero', () => {
    const states: MonthlyState[] = [
      { monthISO: '2026-05', investments: 0, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 8000, expenses: 4000, savings: 4000, events: [] },
      { monthISO: '2026-06', investments: 0, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 8000, expenses: 4000, savings: 4000, events: [] },
    ];
    expect(detectMilestones(states, fireParams).retirementISO).toBeUndefined();
  });
});
