import { describe, it, expect } from 'vitest';
import { isRealSpending, summarizeSpending } from '@/lib/spending-analysis';
import type { Transaction, Category } from '@/types/schema';

const cat = (id: number, type: Category['type']): Category => ({
  id, name: `c${id}`, parentCategoryId: null, color: null, icon: null,
  type, isCapital: false, systemManaged: false,
});
const txn = (over: Partial<Transaction>): Transaction => ({
  id: 1, householdId: 1, date: '2026-03-05', merchant: 'X', merchantRaw: 'X',
  amount: 10, categoryId: 33, sourceAccountId: null, propertyId: null, vehicleId: null,
  sourcePdfFilename: null, reimbursable: false, reimbursedAt: null,
  reimbursedAmount: null, isRecurring: false, notes: null, ...over,
});
const cats = [cat(33, 'NEED'), cat(40, 'INCOME'), cat(41, 'TRANSFER')];
const byId = new Map(cats.map((c) => [c.id!, c]));

describe('isRealSpending', () => {
  it('counts a plain positive charge', () => {
    expect(isRealSpending(txn({}), byId)).toBe(true);
  });
  it('excludes a negative-amount credit', () => {
    expect(isRealSpending(txn({ amount: -50 }), byId)).toBe(false);
  });
  it('excludes a pending reimbursable, includes a reimbursed one', () => {
    expect(isRealSpending(txn({ reimbursable: true, reimbursedAt: null }), byId)).toBe(false);
    expect(isRealSpending(txn({ reimbursable: true, reimbursedAt: '2026-03-20' }), byId)).toBe(true);
  });
  it('excludes Income and Transfer categories', () => {
    expect(isRealSpending(txn({ categoryId: 40 }), byId)).toBe(false);
    expect(isRealSpending(txn({ categoryId: 41 }), byId)).toBe(false);
  });
});

describe('summarizeSpending', () => {
  it('aggregates monthly totals, top merchants, and current vs previous month', () => {
    const txns = [
      txn({ id: 1, date: '2026-02-10', merchant: 'STORE A', amount: 100 }),
      txn({ id: 2, date: '2026-03-04', merchant: 'STORE A', amount: 40 }),
      txn({ id: 3, date: '2026-03-06', merchant: 'STORE B', amount: 60 }),
      txn({ id: 4, date: '2026-03-08', merchant: 'PAYDAY', amount: -500, categoryId: 41 }),
    ];
    const s = summarizeSpending(txns, cats, new Date('2026-03-15T00:00:00Z'));
    expect(s.currentMonthTotal).toBe(100); // Mar: 40 + 60
    expect(s.previousMonthTotal).toBe(100); // Feb: 100
    expect(s.topMerchants[0]).toEqual({ merchant: 'STORE A', total: 140, count: 2 });
    expect(s.monthlyTotals).toEqual([
      { month: '2026-02', total: 100 },
      { month: '2026-03', total: 100 },
    ]);
  });
});
