import { describe, it, expect } from 'vitest';
import {
  applyAnnualReturn,
  applyExtraLoanPayment,
  applyLumpSum,
  monthlyExpenseDeltaFromPeriods,
  monthlyReturnFromAnnual,
  type LoanMonthlyContext,
} from '@/lib/scenarios/apply-real';
import type { ExpensePeriod, LumpSumEvent } from '@/lib/scenarios/lever-types';
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

describe('applyLumpSum', () => {
  const inv: LumpSumEvent = { when: '2030-06-01', amount: 25000, destination: 'investments', label: 'Inheritance' };
  const cash: LumpSumEvent = { when: '2030-06-01', amount: 8000, destination: 'cash' };
  const out: LumpSumEvent = { when: '2030-06-01', amount: -8000, destination: 'investments' };

  it('routes positive inflows to investments', () => {
    const next = applyLumpSum(seed({ investments: 100000 }), inv);
    expect(next.investments).toBe(125000);
  });
  it('routes positive inflows to cash when destination=cash', () => {
    const next = applyLumpSum(seed({ cash: 10000 }), cash);
    expect(next.cash).toBe(18000);
  });
  it('subtracts negative amounts from the chosen destination', () => {
    const next = applyLumpSum(seed({ investments: 100000 }), out);
    expect(next.investments).toBe(92000);
  });
  it('does not affect debt or home equity', () => {
    const next = applyLumpSum(seed({ investments: 100000, debtByLoan: { 1: 50000 }, homeEquity: 300000 }), inv);
    expect(next.debtByLoan[1]).toBe(50000);
    expect(next.homeEquity).toBe(300000);
  });
});

describe('monthlyExpenseDeltaFromPeriods', () => {
  const period: ExpensePeriod = { start: '2026-07-01', monthlyDelta: 1500, durationMonths: 6, label: 'Medical' };

  it('returns 0 before the period starts', () => {
    expect(monthlyExpenseDeltaFromPeriods([period], '2026-06')).toBe(0);
  });
  it('returns the delta during the period', () => {
    expect(monthlyExpenseDeltaFromPeriods([period], '2026-07')).toBe(1500);
    expect(monthlyExpenseDeltaFromPeriods([period], '2026-12')).toBe(1500);
  });
  it('returns 0 after the period ends', () => {
    // 6-month period from 2026-07 → covers 2026-07..2026-12 inclusive; 2027-01 is outside
    expect(monthlyExpenseDeltaFromPeriods([period], '2027-01')).toBe(0);
  });
  it('sums overlapping periods', () => {
    const overlap: ExpensePeriod = { start: '2026-09-01', monthlyDelta: 500, durationMonths: 3 };
    expect(monthlyExpenseDeltaFromPeriods([period, overlap], '2026-10')).toBe(2000);
  });
});

describe('applyExtraLoanPayment', () => {
  const ctx: LoanMonthlyContext = {
    loanId: 1,
    balance: 18400,
    annualRate: 0.059,
    regularMonthlyPayment: 425,
  };

  it('returns balance after regular payment when no extra is configured', () => {
    const next = applyExtraLoanPayment(ctx, undefined, '2027-03');
    expect(next.newBalance).toBeLessThan(18400);
    expect(next.principalPaid).toBeGreaterThan(0);
    expect(next.extraApplied).toBe(0);
  });
  it('applies extra payment to principal, reducing balance faster', () => {
    const noExtra = applyExtraLoanPayment(ctx, undefined, '2027-03');
    const withExtra = applyExtraLoanPayment(ctx, { loanId: 1, extraMonthly: 300 }, '2027-03');
    expect(withExtra.newBalance).toBeLessThan(noExtra.newBalance - 250);
    expect(withExtra.extraApplied).toBe(300);
  });
  it('respects start/end window — no extra applied outside window', () => {
    const win = { loanId: 1, extraMonthly: 300, start: '2028-01-01', end: '2032-12-01' };
    expect(applyExtraLoanPayment(ctx, win, '2027-12').extraApplied).toBe(0);
    expect(applyExtraLoanPayment(ctx, win, '2028-01').extraApplied).toBe(300);
    expect(applyExtraLoanPayment(ctx, win, '2032-12').extraApplied).toBe(300);
    expect(applyExtraLoanPayment(ctx, win, '2033-01').extraApplied).toBe(0);
  });
  it('caps extra at the remaining balance (no negative balance)', () => {
    const tiny: LoanMonthlyContext = { loanId: 1, balance: 100, annualRate: 0.05, regularMonthlyPayment: 425 };
    const result = applyExtraLoanPayment(tiny, { loanId: 1, extraMonthly: 1000 }, '2027-03');
    expect(result.newBalance).toBe(0);
    expect(result.extraApplied).toBeLessThanOrEqual(100);
  });
});
