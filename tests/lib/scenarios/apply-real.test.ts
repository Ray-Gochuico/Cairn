import { describe, it, expect } from 'vitest';
import {
  applyAnnualReturn,
  applyExtraLoanPayment,
  applyGapAllocation,
  applyLumpSum,
  computeMonthlyIncomeForPerson,
  distributeWithinBucket,
  monthlyExpenseFromPeriods,
  monthlyReturnFromAnnual,
  type LoanMonthlyContext,
} from '@/lib/scenarios/apply-real';
import type {
  ExpensePeriod,
  GapAllocation,
  LumpSumEvent,
  PersonIncomePlan,
} from '@/lib/scenarios/lever-types';
import type { MonthlyState } from '@/lib/scenarios/engine';
import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';
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

describe('monthlyExpenseFromPeriods', () => {
  const period: ExpensePeriod = { start: '2026-07-01', monthlyDelta: 1500, durationMonths: 6, label: 'Medical' };

  it('returns 0 before the period starts', () => {
    expect(monthlyExpenseFromPeriods([period], '2026-06')).toBe(0);
  });
  it('returns the delta during the period', () => {
    expect(monthlyExpenseFromPeriods([period], '2026-07')).toBe(1500);
    expect(monthlyExpenseFromPeriods([period], '2026-12')).toBe(1500);
  });
  it('returns 0 after the period ends', () => {
    // 6-month period from 2026-07 → covers 2026-07..2026-12 inclusive; 2027-01 is outside
    expect(monthlyExpenseFromPeriods([period], '2027-01')).toBe(0);
  });
  it('sums overlapping periods', () => {
    const overlap: ExpensePeriod = { start: '2026-09-01', monthlyDelta: 500, durationMonths: 3 };
    expect(monthlyExpenseFromPeriods([period, overlap], '2026-10')).toBe(2000);
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

// ============================================================================
// applyGapAllocation + distributeWithinBucket helpers (2026-05-26 revamp).
// ============================================================================

function makeAccount(id: number, type: AccountType, name = `acct-${id}`): Account {
  return {
    id,
    householdId: 1,
    name,
    type,
    excludedFromNetWorth: false,
  } as unknown as Account;
}

function freshState(savings: number, accountIds: number[] = []): MonthlyState {
  return {
    monthISO: '2026-06',
    investmentsByAccount: Object.fromEntries(accountIds.map((id) => [id, 0])),
    homeEquity: 0,
    cash: 0,
    debtByLoan: {},
    netWorth: 0,
    incomeAfterTax: 0,
    expenses: 0,
    savings,
    events: [],
  };
}

describe('applyGapAllocation', () => {
  const k401 = makeAccount(10, AccountType.ACCOUNT_401K, '401k');
  const rothIra = makeAccount(11, AccountType.ACCOUNT_ROTH_IRA, 'Roth IRA');
  const brokerage = makeAccount(20, AccountType.ACCOUNT_BROKERAGE, 'Vanguard');
  const empty: Account[] = [];

  it('with no allocation configured routes the entire gap to cash', () => {
    const s = freshState(1000, [10, 11, 20]);
    const alloc: GapAllocation = { taxAdvantaged: null, brokerage: null };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401, rothIra], brokerage: [brokerage] });
    expect(s.cash).toBe(1000);
    expect(s.gapToTaxAdvantaged).toBe(0);
    expect(s.gapToBrokerage).toBe(0);
    expect(s.gapToCash).toBe(1000);
    expect(s.investmentsByAccount).toEqual({ 10: 0, 11: 0, 20: 0 });
  });

  it('with 50% percent to tax-advantaged + cash remainder routes correctly', () => {
    const s = freshState(1000, [10, 11, 20]);
    const alloc: GapAllocation = {
      taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null },
      brokerage: null,
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401, rothIra], brokerage: [brokerage] });
    expect(s.gapToTaxAdvantaged).toBe(500);
    expect(s.gapToCash).toBe(500);
    expect(s.cash).toBe(500);
    // Even-split across the two tax-advantaged accounts:
    expect(s.investmentsByAccount[10]).toBe(250);
    expect(s.investmentsByAccount[11]).toBe(250);
    expect(s.investmentsByAccount[20]).toBe(0);
  });

  it('with two percent buckets at 50% and 25% routes 75% to investments and 25% to cash', () => {
    const s = freshState(1000, [10, 20]);
    const alloc: GapAllocation = {
      taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null },
      brokerage:     { mode: 'percent', value: 0.25, accountSplits: null },
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401], brokerage: [brokerage] });
    expect(s.gapToTaxAdvantaged).toBe(500);
    // Both percent buckets distribute over the ORIGINAL gap of $1000 (post-fixed
    // remaining is the same here since there are no fixed buckets):
    //   tax-adv = 1000 * 0.5 = 500
    //   brokerage = 1000 * 0.25 = 250
    // Note the test's prior comment misspoke — both buckets share `remaining`,
    // which after phase 1 (no fixed) equals the originalGap.
    expect(s.gapToBrokerage).toBe(250);
    expect(s.gapToCash).toBe(250);
    expect(s.cash).toBe(250);
  });

  it('with fixed-dollar bucket + percent bucket: fixed consumes first then percent over remainder', () => {
    const s = freshState(1000, [10, 20]);
    const alloc: GapAllocation = {
      brokerage:     { mode: 'fixed',   value: 200, accountSplits: null },  // $200 first
      taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null }, // 50% of $800
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401], brokerage: [brokerage] });
    expect(s.gapToBrokerage).toBe(200);
    expect(s.gapToTaxAdvantaged).toBe(400);
    expect(s.gapToCash).toBe(400);
    expect(s.cash).toBe(400);
  });

  it('with fixed > gap clamps the fixed amount to the gap', () => {
    const s = freshState(500, [20]);
    const alloc: GapAllocation = {
      brokerage:     { mode: 'fixed', value: 1000, accountSplits: null },
      taxAdvantaged: null,
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [], brokerage: [brokerage] });
    expect(s.gapToBrokerage).toBe(500);
    expect(s.gapToCash).toBe(0);
    expect(s.cash).toBe(0);
  });

  it('with two fixed-dollar buckets summing > gap clamps proportionally', () => {
    const s = freshState(600, [10, 20]);
    const alloc: GapAllocation = {
      taxAdvantaged: { mode: 'fixed', value: 600, accountSplits: null },  // 60% of total
      brokerage:     { mode: 'fixed', value: 400, accountSplits: null },  // 40% of total
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401], brokerage: [brokerage] });
    // Sum 1000 > 600 → scale to (600/1000) each: 360 + 240 = 600.
    expect(s.gapToTaxAdvantaged).toBe(360);
    expect(s.gapToBrokerage).toBe(240);
    expect(s.gapToCash).toBe(0);
  });

  it('with two percent buckets summing > 1.0 normalizes proportionally', () => {
    const s = freshState(1000, [10, 20]);
    const alloc: GapAllocation = {
      taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null }, // 5/11 after normalization
      brokerage:     { mode: 'percent', value: 0.6, accountSplits: null }, // 6/11 after normalization
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401], brokerage: [brokerage] });
    // After normalize: 0.5/1.1 ≈ 0.4545 and 0.6/1.1 ≈ 0.5455. They consume 100% of the gap.
    expect(s.gapToTaxAdvantaged).toBeCloseTo(454.55, 1);
    expect(s.gapToBrokerage).toBeCloseTo(545.45, 1);
    expect(s.gapToCash).toBeCloseTo(0, 1);
  });

  it('empty tax-advantaged bucket with 50% allocation redirects to cash', () => {
    const s = freshState(1000, [20]);
    const alloc: GapAllocation = {
      taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null },
      brokerage:     null,
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: empty, brokerage: [brokerage] });
    expect(s.gapToTaxAdvantaged).toBe(0);
    expect(s.gapToCash).toBe(1000);
    expect(s.cash).toBe(1000);
  });

  it('empty fixed-dollar bucket redirects to cash (stays in remaining)', () => {
    const s = freshState(1000, [20]);
    const alloc: GapAllocation = {
      taxAdvantaged: { mode: 'fixed', value: 300, accountSplits: null },
      brokerage:     null,
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: empty, brokerage: [brokerage] });
    expect(s.gapToTaxAdvantaged).toBe(0);
    expect(s.gapToCash).toBe(1000);
  });

  it('per-account splits 60/40 within tax-advantaged are honored', () => {
    const s = freshState(1000, [10, 11, 20]);
    const alloc: GapAllocation = {
      taxAdvantaged: {
        mode: 'percent',
        value: 1.0,
        accountSplits: [
          { accountId: 10, pct: 0.6 },
          { accountId: 11, pct: 0.4 },
        ],
      },
      brokerage: null,
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401, rothIra], brokerage: [brokerage] });
    expect(s.investmentsByAccount[10]).toBe(600);
    expect(s.investmentsByAccount[11]).toBe(400);
    expect(s.gapToTaxAdvantaged).toBe(1000);
  });

  it('all-stale account splits fall back to even split across surviving accounts in the bucket', () => {
    const s = freshState(1000, [10, 11]);
    const alloc: GapAllocation = {
      taxAdvantaged: {
        mode: 'percent',
        value: 1.0,
        accountSplits: [
          { accountId: 999, pct: 1.0 },  // stale — account doesn't exist
        ],
      },
      brokerage: null,
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401, rothIra], brokerage: [] });
    // All stale → even split between 401k (10) and Roth (11).
    expect(s.investmentsByAccount[10]).toBe(500);
    expect(s.investmentsByAccount[11]).toBe(500);
  });

  it('partially-stale account splits filter + re-normalize', () => {
    const s = freshState(1000, [10, 11]);
    const alloc: GapAllocation = {
      taxAdvantaged: {
        mode: 'percent',
        value: 1.0,
        accountSplits: [
          { accountId: 10,  pct: 0.6 },
          { accountId: 999, pct: 0.4 },  // stale — gets filtered
        ],
      },
      brokerage: null,
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401, rothIra], brokerage: [] });
    // After filtering 999, only 10's 0.6 survives. Renormalize to 1.0:
    // account 10 gets the full $1000.
    expect(s.investmentsByAccount[10]).toBe(1000);
    expect(s.investmentsByAccount[11]).toBe(0);
  });

  it('negative s.savings is a no-op (caller should not invoke; defensive)', () => {
    const s = freshState(-500, [10, 20]);
    const alloc: GapAllocation = {
      taxAdvantaged: { mode: 'percent', value: 0.5, accountSplits: null },
      brokerage:     null,
    };
    applyGapAllocation(s, alloc, { taxAdvantaged: [k401], brokerage: [brokerage] });
    expect(s.cash).toBe(0);
    expect(s.gapToTaxAdvantaged).toBe(0);
    expect(s.gapToCash).toBe(0);
    expect(s.investmentsByAccount[10]).toBe(0);
  });
});

describe('distributeWithinBucket', () => {
  const k401 = makeAccount(10, AccountType.ACCOUNT_401K);
  const rothIra = makeAccount(11, AccountType.ACCOUNT_ROTH_IRA);

  it('even-splits across accounts when accountSplits is null', () => {
    const s = freshState(0, [10, 11]);
    distributeWithinBucket(s, 'taxAdvantaged', 1000, null, [k401, rothIra]);
    expect(s.investmentsByAccount[10]).toBe(500);
    expect(s.investmentsByAccount[11]).toBe(500);
  });

  it('honors accountSplits proportions', () => {
    const s = freshState(0, [10, 11]);
    distributeWithinBucket(s, 'taxAdvantaged', 1000, [
      { accountId: 10, pct: 0.7 },
      { accountId: 11, pct: 0.3 },
    ], [k401, rothIra]);
    expect(s.investmentsByAccount[10]).toBe(700);
    expect(s.investmentsByAccount[11]).toBe(300);
  });

  it('falls back to even split when ALL split ids are stale', () => {
    const s = freshState(0, [10, 11]);
    distributeWithinBucket(s, 'taxAdvantaged', 1000, [
      { accountId: 999, pct: 1.0 },
    ], [k401, rothIra]);
    expect(s.investmentsByAccount[10]).toBe(500);
    expect(s.investmentsByAccount[11]).toBe(500);
  });

  it('no-ops when accounts array is empty', () => {
    const s = freshState(0);
    distributeWithinBucket(s, 'taxAdvantaged', 1000, null, []);
    expect(s.investmentsByAccount).toEqual({});
  });

  it('no-ops when amount is 0', () => {
    const s = freshState(0, [10, 11]);
    distributeWithinBucket(s, 'taxAdvantaged', 0, null, [k401, rothIra]);
    expect(s.investmentsByAccount[10]).toBe(0);
    expect(s.investmentsByAccount[11]).toBe(0);
  });
});

describe('monthlyExpenseFromPeriods — revamp', () => {
  it('sums monthlyDelta across active overlapping periods', () => {
    const result = monthlyExpenseFromPeriods(
      [
        { start: '2026-01-01', monthlyDelta: 4000, durationMonths: 12 },
        { start: '2026-06-01', monthlyDelta: 500,  durationMonths: 3  },
      ],
      '2026-07',
    );
    expect(result).toBe(4500);
  });

  it('returns 0 when no periods are active', () => {
    expect(monthlyExpenseFromPeriods([], '2026-07')).toBe(0);
    expect(
      monthlyExpenseFromPeriods(
        [{ start: '2027-01-01', monthlyDelta: 500, durationMonths: 1 }],
        '2026-07',
      ),
    ).toBe(0);
  });
});
