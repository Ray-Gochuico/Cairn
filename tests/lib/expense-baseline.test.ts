import { describe, it, expect } from 'vitest';
import { computeBaselineExpenses, recentMonthlyExpenseTotals, rolling12mBaseline, latestCompleteMonthBaseline } from '@/lib/expense-baseline';
import type { Transaction, Category } from '@/types/schema';

// Sign convention: per the Transaction schema, amount > 0 is a purchase/expense
// and amount < 0 is a refund/credit. These tests mirror that convention.

const tx = (id: number, date: string, amount: number): Transaction =>
  ({
    id,
    householdId: 1,
    date,
    amount,
    merchant: 'M',
    merchantRaw: null,
    categoryId: 1,
    sourceAccountId: 1,
  } as unknown as Transaction);

describe('computeBaselineExpenses', () => {
  it('returns 0 when no transactions exist', () => {
    expect(computeBaselineExpenses([], '2026-05-01')).toBe(0);
  });

  it('divides by months observed, not by 12, for 4 months of data', () => {
    // $2,000 spent in each of Feb, Mar, Apr, May 2026 → total $8,000 / 4 months = $2,000.
    const txs = [
      tx(1, '2026-02-10', 2000),
      tx(2, '2026-03-10', 2000),
      tx(3, '2026-04-10', 2000),
      tx(4, '2026-05-01', 2000),
    ];
    expect(computeBaselineExpenses(txs, '2026-05-01')).toBeCloseTo(2000, 0);
  });

  it('divides by 12 when 12 distinct months of data exist', () => {
    // $1,200/mo for 12 months → total $14,400 / 12 = $1,200.
    const txs: Transaction[] = [];
    let id = 1;
    for (let m = 6; m <= 17; m++) {
      const yyyymm =
        m <= 12
          ? `2025-${String(m).padStart(2, '0')}`
          : `2026-${String(m - 12).padStart(2, '0')}`;
      txs.push(tx(id++, `${yyyymm}-15`, 1200));
    }
    expect(computeBaselineExpenses(txs, '2026-05-20')).toBeCloseTo(1200, 0);
  });

  it('aggregates multiple transactions within a single month into that month', () => {
    // Two transactions in one month should not inflate monthsObserved.
    const txs = [
      tx(1, '2026-04-05', 1500),
      tx(2, '2026-04-25', 2500),
    ];
    // 1 month observed, total $4,000 → /1 = $4,000.
    expect(computeBaselineExpenses(txs, '2026-05-01')).toBeCloseTo(4000, 0);
  });

  it('ignores transactions outside the 12-month rolling window', () => {
    const txs = [
      tx(1, '2026-04-15', 1000),
      tx(2, '2023-01-01', 50_000), // ancient — out of window
    ];
    expect(computeBaselineExpenses(txs, '2026-05-01')).toBeCloseTo(1000, 0);
  });

  it('ignores transactions dated after asOfISO (future)', () => {
    const txs = [
      tx(1, '2026-04-15', 1000),
      tx(2, '2027-01-01', 50_000), // future — anchored window excludes this
    ];
    expect(computeBaselineExpenses(txs, '2026-05-01')).toBeCloseTo(1000, 0);
  });

  it('excludes refunds/credits (amount < 0) so they do not deflate the baseline', () => {
    // April: $2,000 purchase + $500 refund. Baseline should be $2,000 (only the purchase),
    // NOT $1,500 (net) and NOT something derived from the refund.
    const txs = [
      tx(1, '2026-04-05', 2000), // purchase
      tx(2, '2026-04-20', -500), // refund — must be ignored
    ];
    expect(computeBaselineExpenses(txs, '2026-05-01')).toBeCloseTo(2000, 0);
  });
});

describe('recentMonthlyExpenseTotals', () => {
  it('returns the most recent month totals, descending, limited to N', () => {
    const txs = [
      tx(1, '2026-04-15', 1500), tx(2, '2026-04-20', 200),
      tx(3, '2026-03-01', 2200),
      tx(4, '2026-02-10', 1800),
      tx(5, '2026-01-10', 1700),
      tx(6, '2025-12-31', 1900),
      tx(7, '2025-11-15', 1600),
    ];
    const out = recentMonthlyExpenseTotals(txs, '2026-05-01', 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ monthISO: '2026-04', total: 1700 });
    expect(out[1].monthISO).toBe('2026-03');
    expect(out[4].monthISO).toBe('2025-12');
  });

  it('excludes refunds/credits and future months', () => {
    const txs = [
      tx(1, '2026-04-15', -5000), // refund — must be ignored
      tx(2, '2026-04-15', 1000),
      tx(3, '2026-06-15', 500),   // future relative to asOfISO
    ];
    const out = recentMonthlyExpenseTotals(txs, '2026-05-01', 6);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ monthISO: '2026-04', total: 1000 });
  });
});

// Categories that drive isRealSpending: TRANSFER/INCOME are excluded.
const cat = (id: number, type: Category['type']): Category =>
  ({ id, name: `c${id}`, parentCategoryId: null, color: null, icon: null, type, isCapital: false, systemManaged: false, monthlyBudget: null } as Category);
const SPENDING = cat(1, 'EXPENSE');
const TRANSFER = cat(2, 'TRANSFER');
const INCOME = cat(3, 'INCOME');
const categories = [SPENDING, TRANSFER, INCOME];

// reuse the `tx` helper from the top of this file, then override categoryId per case.
const txc = (id: number, date: string, amount: number, categoryId: number): Transaction =>
  ({ ...tx(id, date, amount), categoryId } as Transaction);

describe('rolling12mBaseline — real-spending-filtered', () => {
  it('matches a distinct-months average but EXCLUDES transfers/income', () => {
    const txs = [
      txc(1, '2026-04-10', 2000, SPENDING.id!),
      txc(2, '2026-04-20', 9999, TRANSFER.id!),  // excluded
      txc(3, '2026-03-10', 2000, SPENDING.id!),
      txc(4, '2026-02-10', 2000, INCOME.id!),     // excluded (still counts as a month? no — filtered out entirely)
    ];
    // Real spending: Apr 2000 + Mar 2000 over 2 distinct months = 2000.
    expect(rolling12mBaseline(txs, categories, '2026-05-01')).toBeCloseTo(2000, 0);
  });

  it('nets a reimbursed transaction to out-of-pocket', () => {
    const txs = [
      { ...txc(1, '2026-04-10', 1000, SPENDING.id!), reimbursable: true, reimbursedAt: '2026-04-15', reimbursedAmount: 400 } as Transaction,
    ];
    // effectiveSpendingAmount = 1000 - 400 = 600, over 1 month.
    expect(rolling12mBaseline(txs, categories, '2026-05-01')).toBeCloseTo(600, 0);
  });

  it('returns 0 with no real spending in the window', () => {
    expect(rolling12mBaseline([], categories, '2026-05-01')).toBe(0);
  });

  // --- Window-edge (calendar-month bound) cases. These are the ONLY guard on
  // the data-mode window math; the Task-2 byte-for-byte test never reaches it. ---

  it('uses a calendar-month bound, NOT a 360-day window: a tx exactly 12 months back is IN', () => {
    // asOf month = 2026-05 → lowerMonth = 2025-06. A late-in-month charge in
    // 2025-06 is INCLUDED (a 360-day day-window anchored at 2026-05-01 would
    // exclude a 2025-06-30 charge — that is the boundary bug this asserts gone).
    const txs = [
      txc(1, '2025-06-30', 1500, SPENDING.id!), // exactly the 12-month-back month → IN
      txc(2, '2026-04-10', 2500, SPENDING.id!),
    ];
    // Two distinct months in-window: (1500 + 2500) / 2 = 2000.
    expect(rolling12mBaseline(txs, categories, '2026-05-15')).toBeCloseTo(2000, 0);
  });

  it('drops a tx 13 calendar months back (outside the trailing-12 window)', () => {
    // asOf month = 2026-05 → lowerMonth = 2025-06. 2025-05 is one month too old.
    const txs = [
      txc(1, '2025-05-30', 9999, SPENDING.id!), // 13 months back → OUT
      txc(2, '2026-04-10', 3000, SPENDING.id!), // in-window
    ];
    expect(rolling12mBaseline(txs, categories, '2026-05-15')).toBeCloseTo(3000, 0);
  });

  it('mid-month vs 1st-of-month asOf yield the SAME window (day-of-month invariant)', () => {
    const txs = [
      txc(1, '2025-06-15', 1200, SPENDING.id!), // boundary month
      txc(2, '2026-04-10', 2800, SPENDING.id!),
    ];
    // Both anchors resolve to the same calendar window 2025-06..2026-05.
    expect(rolling12mBaseline(txs, categories, '2026-05-28')).toBeCloseTo(2000, 0);
    expect(rolling12mBaseline(txs, categories, '2026-05-01')).toBeCloseTo(2000, 0);
  });

  it('INCLUDES the in-progress month (an average tolerates a partial month)', () => {
    // Unlike latestMonth, rolling12m counts asOf's own (in-progress) month.
    const txs = [
      txc(1, '2026-05-09', 1000, SPENDING.id!), // in-progress month — IN for rolling12m
      txc(2, '2026-04-10', 3000, SPENDING.id!),
    ];
    expect(rolling12mBaseline(txs, categories, '2026-05-15')).toBeCloseTo(2000, 0);
  });

  it('returns 0 when the only data is OLDER than the trailing-12 window', () => {
    const txs = [txc(1, '2024-01-10', 5000, SPENDING.id!)]; // far outside 2025-06..2026-05
    expect(rolling12mBaseline(txs, categories, '2026-05-15')).toBe(0);
  });
});

describe('latestCompleteMonthBaseline — excludes the in-progress month', () => {
  it('mid-month asOf returns the PRIOR complete month, not the in-progress one', () => {
    const txs = [
      txc(1, '2026-05-10', 5000, SPENDING.id!), // in-progress (asOf is 2026-05-15) — excluded
      txc(2, '2026-04-12', 3000, SPENDING.id!), // latest COMPLETE month
      txc(3, '2026-03-12', 2000, SPENDING.id!),
    ];
    expect(latestCompleteMonthBaseline(txs, categories, '2026-05-15')).toBeCloseTo(3000, 0);
  });

  it('1st-of-month asOf still excludes that month (it is in progress)', () => {
    const txs = [
      txc(1, '2026-05-01', 5000, SPENDING.id!), // month 2026-05 == asOf month — excluded
      txc(2, '2026-04-12', 3000, SPENDING.id!),
    ];
    expect(latestCompleteMonthBaseline(txs, categories, '2026-05-01')).toBeCloseTo(3000, 0);
  });

  it('returns 0 when the only data is in the in-progress month (empty-after-exclusion)', () => {
    const txs = [txc(1, '2026-05-09', 5000, SPENDING.id!)];
    expect(latestCompleteMonthBaseline(txs, categories, '2026-05-15')).toBe(0);
  });

  it('sums multiple charges within the latest complete month', () => {
    const txs = [
      txc(1, '2026-04-03', 1200, SPENDING.id!),
      txc(2, '2026-04-27', 800, SPENDING.id!),
      txc(3, '2026-04-15', 500, TRANSFER.id!), // excluded
    ];
    expect(latestCompleteMonthBaseline(txs, categories, '2026-05-20')).toBeCloseTo(2000, 0);
  });
});
