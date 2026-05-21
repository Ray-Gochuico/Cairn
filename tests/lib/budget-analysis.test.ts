import { describe, it, expect } from 'vitest';
import { summarizeBudget, budgetableCategories } from '@/lib/budget-analysis';
import type { Transaction, Category } from '@/types/schema';

const cat = (over: Partial<Category> & { id: number }): Category => ({
  name: `c${over.id}`, parentCategoryId: null, color: null, icon: null,
  type: 'WANT', isCapital: false, systemManaged: false, monthlyBudget: null, ...over,
});
const txn = (over: Partial<Transaction>): Transaction => ({
  id: 1, householdId: 1, date: '2026-03-05', merchant: 'X', merchantRaw: 'X', amount: 10,
  categoryId: 33, sourceAccountId: null, propertyId: null, vehicleId: null, personId: null,
  sourcePdfFilename: null, reimbursable: false, reimbursedAt: null, reimbursedAmount: null,
  isRecurring: false, notes: null, ...over,
});

// 1 = Home (parent), 7 = Maintenance (Home child, NEED), 33 = Groceries (NEED standalone),
// 40 = Income (INCOME), 50 = Mortgage Principal (system-managed leaf under Home)
const categories: Category[] = [
  cat({ id: 1, name: 'Home', type: 'NEED' }),
  cat({ id: 7, name: 'Maintenance', parentCategoryId: 1, type: 'NEED', monthlyBudget: 200 }),
  cat({ id: 33, name: 'Groceries', type: 'NEED', monthlyBudget: 600 }),
  cat({ id: 40, name: 'Income', type: 'INCOME' }),
  cat({ id: 50, name: 'Mortgage Principal', parentCategoryId: 1, type: 'NEED', systemManaged: true }),
];

describe('budgetableCategories', () => {
  it('keeps leaf NEED/WANT non-system categories, drops parents/income/system rows', () => {
    const ids = budgetableCategories(categories).map((c) => c.id).sort((a, b) => a! - b!);
    expect(ids).toEqual([7, 33]); // not 1 (parent), not 40 (INCOME), not 50 (system)
  });
});

describe('summarizeBudget', () => {
  it('computes actual, remaining, pct, and overBudget for the given month', () => {
    const txns = [
      txn({ id: 1, date: '2026-03-04', categoryId: 33, amount: 700 }), // Groceries, over
      txn({ id: 2, date: '2026-03-09', categoryId: 7, amount: 50 }),   // Maintenance, under
      txn({ id: 3, date: '2026-02-15', categoryId: 33, amount: 999 }), // wrong month — ignored
    ];
    const s = summarizeBudget(categories, txns, '2026-03');
    const groceries = s.rows.find((r) => r.categoryId === 33)!;
    expect(groceries.actual).toBe(700);
    expect(groceries.remaining).toBe(-100);
    expect(groceries.overBudget).toBe(true);
    expect(groceries.pct).toBeCloseTo(700 / 600);
    const maint = s.rows.find((r) => r.categoryId === 7)!;
    expect(maint.actual).toBe(50);
    expect(maint.overBudget).toBe(false);
    expect(s.totalBudget).toBe(800);
    expect(s.totalActual).toBe(750);
  });

  it('counts a reimbursed transaction at its net out-of-pocket amount', () => {
    const txns = [
      txn({ id: 1, date: '2026-03-04', categoryId: 33, amount: 200,
        reimbursable: true, reimbursedAt: '2026-03-20', reimbursedAmount: 150 }),
    ];
    const s = summarizeBudget(categories, txns, '2026-03');
    expect(s.rows.find((r) => r.categoryId === 33)!.actual).toBe(50);
  });
});
