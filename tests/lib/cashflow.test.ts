import { describe, it, expect } from 'vitest';
import { cashflowWindow } from '@/lib/cashflow';
import type { Transaction, Category } from '@/types/schema';

const txn = (id: number, date: string, amount: number, categoryId: number | null, over: Partial<Transaction> = {}): Transaction => ({
  id, householdId: 1, date, merchant: 'X', merchantRaw: 'X', amount, categoryId,
  sourceAccountId: null, propertyId: null, vehicleId: null, personId: null,
  sourcePdfFilename: null, reimbursable: false, reimbursedAt: null, reimbursedAmount: null,
  isRecurring: false, notes: null, ...over,
});

const cat = (id: number, type: Category['type'] = 'NEED'): Category => ({
  id, name: `c${id}`, parentCategoryId: null, color: null, icon: null,
  type, isCapital: false, systemManaged: false,
});

// Plain NEED categories used in the baseline test — amounts should be unchanged
const baselineCats: Category[] = [cat(33), cat(32)];

describe('cashflowWindow', () => {
  it('sums outflow in-window and computes net against the supplied inflow', () => {
    const asOf = new Date('2026-03-30T00:00:00Z');
    const txns = [
      txn(1, '2026-03-20', 100, 33),
      txn(2, '2026-03-25', 50, 32),
      txn(3, '2026-01-01', 999, 33), // outside the 30-day window
      txn(4, '2026-03-26', -500, 41), // a credit — not outflow
    ];
    const cf = cashflowWindow(txns, 4000, 30, baselineCats, asOf);
    expect(cf.outflow).toBe(150);
    expect(cf.inflow).toBe(4000);
    expect(cf.net).toBe(3850);
    expect(cf.outflowByCategory).toEqual(
      expect.arrayContaining([
        { categoryId: 33, total: 100 },
        { categoryId: 32, total: 50 },
      ]),
    );
  });

  it('excludes a positive-amount transaction in an INCOME-typed category from outflow', () => {
    const incomeCat = cat(50, 'INCOME');
    const transferCat = cat(51, 'TRANSFER');
    const allCats: Category[] = [...baselineCats, incomeCat, transferCat];
    const asOf = new Date('2026-03-30T00:00:00Z');
    const txns = [
      txn(1, '2026-03-20', 100, 33),              // NEED — counts
      txn(2, '2026-03-25', 1500, 50),             // INCOME — excluded
      txn(3, '2026-03-26', 800, 51),              // TRANSFER — excluded
    ];
    const cf = cashflowWindow(txns, 0, 30, allCats, asOf);
    expect(cf.outflow).toBe(100);
    expect(cf.outflowByCategory).toEqual([{ categoryId: 33, total: 100 }]);
  });

  it('excludes a pending reimbursable from outflow', () => {
    const asOf = new Date('2026-03-30T00:00:00Z');
    const txns = [
      txn(1, '2026-03-20', 100, 33),
      txn(2, '2026-03-21', 200, 33, { reimbursable: true, reimbursedAt: null }), // pending — excluded
    ];
    const cf = cashflowWindow(txns, 0, 30, baselineCats, asOf);
    expect(cf.outflow).toBe(100);
  });

  it('counts a reimbursed transaction at its net amount', () => {
    const asOf = new Date('2026-03-30T00:00:00Z');
    const txns = [
      txn(1, '2026-03-20', 100, 33),
      // Paid $500, reimbursed $400 → net $100
      txn(2, '2026-03-21', 500, 33, { reimbursable: true, reimbursedAt: '2026-03-25', reimbursedAmount: 400 }),
    ];
    const cf = cashflowWindow(txns, 0, 30, baselineCats, asOf);
    expect(cf.outflow).toBe(200); // 100 + 100 net
  });
});
