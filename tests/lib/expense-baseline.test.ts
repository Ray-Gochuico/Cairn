import { describe, it, expect } from 'vitest';
import { computeBaselineExpenses, recentMonthlyExpenseTotals } from '@/lib/expense-baseline';
import type { Transaction } from '@/types/schema';

const tx = (id: number, date: string, amount: number): Transaction =>
  ({ id, householdId: 1, date, amount, merchant: 'X', merchantRaw: null, categoryId: 5, sourceAccountId: 2 } as unknown as Transaction);

describe('computeBaselineExpenses', () => {
  it('returns 0 when there are no outflows', () => {
    expect(computeBaselineExpenses([], '2026-05-01')).toBe(0);
  });
  it('averages outflows over distinct months observed in the trailing window', () => {
    const txs = [
      tx(1, '2026-04-15', -3000),
      tx(2, '2026-03-15', -3500),
      tx(3, '2026-02-15', -2800),
    ];
    expect(computeBaselineExpenses(txs, '2026-05-01')).toBeCloseTo(3100, 0);
  });
  it('ignores positive amounts (income)', () => {
    const txs = [tx(1, '2026-04-15', 5000), tx(2, '2026-04-20', -2000)];
    expect(computeBaselineExpenses(txs, '2026-05-01')).toBe(2000);
  });
});

describe('recentMonthlyExpenseTotals', () => {
  it('returns the most recent month totals, descending, limited to N', () => {
    const txs = [
      tx(1, '2026-04-15', -1500), tx(2, '2026-04-20', -200),
      tx(3, '2026-03-01', -2200),
      tx(4, '2026-02-10', -1800),
      tx(5, '2026-01-10', -1700),
      tx(6, '2025-12-31', -1900),
      tx(7, '2025-11-15', -1600),
    ];
    const out = recentMonthlyExpenseTotals(txs, '2026-05-01', 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ monthISO: '2026-04', total: 1700 });
    expect(out[1].monthISO).toBe('2026-03');
    expect(out[4].monthISO).toBe('2025-12');
  });

  it('excludes positive amounts and future months', () => {
    const txs = [
      tx(1, '2026-04-15', 5000),
      tx(2, '2026-04-15', -1000),
      tx(3, '2026-06-15', -500), // future relative to startISO
    ];
    const out = recentMonthlyExpenseTotals(txs, '2026-05-01', 6);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ monthISO: '2026-04', total: 1000 });
  });
});
