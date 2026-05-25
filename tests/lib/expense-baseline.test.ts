import { describe, it, expect } from 'vitest';
import { computeBaselineExpenses, recentMonthlyExpenseTotals } from '@/lib/expense-baseline';
import type { Transaction } from '@/types/schema';

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
