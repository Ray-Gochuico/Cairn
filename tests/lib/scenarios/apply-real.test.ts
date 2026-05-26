import { describe, it, expect } from 'vitest';
import {
  applyAnnualReturn,
  applyExtraLoanPayment,
  applyLumpSum,
  computeMonthlyIncomeForPerson,
  monthlyExpenseDeltaFromPeriods,
  monthlyReturnFromAnnual,
  type LoanMonthlyContext,
} from '@/lib/scenarios/apply-real';
import type { ExpensePeriod, LumpSumEvent, PersonIncomePlan } from '@/lib/scenarios/lever-types';
import type { MonthlyState } from '@/lib/scenarios/engine';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';

interface SeedOverrides extends Partial<Omit<MonthlyState, 'investmentsByAccount'>> {
  investments?: number;
  investmentsByAccount?: Record<number, number>;
}

const seed = (overrides: SeedOverrides = {}): MonthlyState => {
  const { investments, investmentsByAccount, ...rest } = overrides;
  const byAccount = investmentsByAccount
    ?? (investments !== undefined ? { 1: investments } : { 1: 100000 });
  return {
    monthISO: '2027-01',
    investmentsByAccount: byAccount,
    homeEquity: 0,
    cash: 0,
    debtByLoan: {},
    netWorth: 100000,
    incomeAfterTax: 0,
    expenses: 0,
    savings: 0,
    events: [],
    ...rest,
  };
};

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
    expect(totalInvestments(next)).toBeCloseTo(100000 * 1.00949, 0);
  });
  it('does not touch cash, debt, or home equity', () => {
    const next = applyAnnualReturn(seed({ investments: 50000, cash: 10000, homeEquity: 300000, debtByLoan: { 1: 200000 } }), 0.07);
    expect(next.cash).toBe(10000);
    expect(next.homeEquity).toBe(300000);
    expect(next.debtByLoan[1]).toBe(200000);
  });
  it('grows per-account balances proportionally when given a multi-account record', () => {
    const next = applyAnnualReturn(seed({ investmentsByAccount: { 1: 60000, 2: 40000 } }), 0.12);
    expect(next.investmentsByAccount[1]).toBeCloseTo(60000 * 1.00949, 0);
    expect(next.investmentsByAccount[2]).toBeCloseTo(40000 * 1.00949, 0);
  });
});

describe('applyLumpSum', () => {
  const inv: LumpSumEvent = { when: '2030-06-01', amount: 25000, destination: 'investments', label: 'Inheritance' };
  const cashEvt: LumpSumEvent = { when: '2030-06-01', amount: 8000, destination: 'cash' };
  const out: LumpSumEvent = { when: '2030-06-01', amount: -8000, destination: 'investments' };
  // Single-account allocation: 100% of any investment lump goes to account 1.
  const allocSingle = { 1: 1 };

  it('routes positive inflows to investments via the allocation map', () => {
    const next = applyLumpSum(seed({ investments: 100000 }), inv, allocSingle);
    expect(totalInvestments(next)).toBe(125000);
  });
  it('routes positive inflows to cash when destination=cash (allocation ignored)', () => {
    const next = applyLumpSum(seed({ cash: 10000 }), cashEvt, allocSingle);
    expect(next.cash).toBe(18000);
  });
  it('subtracts negative amounts from the chosen destination', () => {
    const next = applyLumpSum(seed({ investments: 100000 }), out, allocSingle);
    expect(totalInvestments(next)).toBe(92000);
  });
  it('does not affect debt or home equity', () => {
    const next = applyLumpSum(seed({ investments: 100000, debtByLoan: { 1: 50000 }, homeEquity: 300000 }), inv, allocSingle);
    expect(next.debtByLoan[1]).toBe(50000);
    expect(next.homeEquity).toBe(300000);
  });
  it('distributes investment lump sums across accounts according to allocation', () => {
    const next = applyLumpSum(
      seed({ investmentsByAccount: { 1: 60000, 2: 40000 } }),
      inv, // +25k
      { 1: 0.8, 2: 0.2 },
    );
    expect(next.investmentsByAccount[1]).toBe(60000 + 25000 * 0.8);
    expect(next.investmentsByAccount[2]).toBe(40000 + 25000 * 0.2);
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

describe('computeMonthlyIncomeForPerson', () => {
  const baseSalary = 135000;
  const startYear = 2026;

  it('grows by raise rate each January', () => {
    const plan: PersonIncomePlan = { annualRaiseRate: 0.03, events: [] };
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2026-06', startYear)).toBeCloseTo(135000 / 12, 0);
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2027-01', startYear)).toBeCloseTo(135000 * 1.03 / 12, 0);
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2028-06', startYear)).toBeCloseTo(135000 * 1.03 * 1.03 / 12, 0);
  });

  it('promotion event sets new salary; subsequent raises compound from new base', () => {
    const plan: PersonIncomePlan = {
      annualRaiseRate: 0.03,
      events: [{ when: '2028-04-01', type: 'promotion', newSalary: 168000 }],
    };
    // March 2028: still under prior trajectory (135K × 1.03² = 143,221.5) / 12
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2028-03', startYear)).toBeCloseTo(135000 * 1.03 * 1.03 / 12, 1);
    // April 2028: jumped to 168K
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2028-04', startYear)).toBeCloseTo(168000 / 12, 0);
    // Jan 2029: 168K × 1.03
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2029-01', startYear)).toBeCloseTo(168000 * 1.03 / 12, 0);
  });

  it('sabbatical drops income to 0 for the configured duration', () => {
    const plan: PersonIncomePlan = {
      annualRaiseRate: 0.03,
      events: [{ when: '2034-07-01', type: 'sabbatical', durationMonths: 6 }],
    };
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2034-06', startYear)).toBeGreaterThan(0);
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2034-07', startYear)).toBe(0);
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2034-12', startYear)).toBe(0);
    // Resumes Jan 2035 at pre-sabbatical salary
    expect(computeMonthlyIncomeForPerson(baseSalary, plan, '2035-01', startYear)).toBeGreaterThan(0);
  });
});
