import { describe, it, expect } from 'vitest';
import { propertyCostBasis, rollingExpense } from '@/lib/cost-basis';
import type { Transaction, Category } from '@/types/schema';

const cat = (id: number, isCapital: boolean, type: Category['type'] = 'NEED'): Category => ({
  id, name: `c${id}`, parentCategoryId: 1, color: null, icon: null,
  type, isCapital, systemManaged: false,
});
const txn = (over: Partial<Transaction>): Transaction => ({
  id: 1, householdId: 1, date: '2026-03-05', merchant: 'X', merchantRaw: 'X',
  amount: 100, categoryId: 12, sourceAccountId: null, propertyId: 7, vehicleId: null,
  personId: null, sourcePdfFilename: null, reimbursable: false, reimbursedAt: null,
  reimbursedAmount: null, isRecurring: false, notes: null, ...over,
});
const cats = [cat(12, true), cat(11, false)]; // 12 = Capital Improvements, 11 = Home Maintenance

describe('propertyCostBasis', () => {
  it('sums purchase price plus capital-improvement transactions for the property', () => {
    const txns = [
      txn({ id: 1, amount: 5000, categoryId: 12, propertyId: 7 }), // capital
      txn({ id: 2, amount: 300, categoryId: 11, propertyId: 7 }),  // maintenance, not capital
      txn({ id: 3, amount: 9000, categoryId: 12, propertyId: 9 }), // other property
    ];
    expect(propertyCostBasis(400000, 7, txns, cats)).toBe(405000);
  });
  it('treats a null purchase price as 0', () => {
    expect(propertyCostBasis(null, 7, [], cats)).toBe(0);
  });
});

describe('rollingExpense', () => {
  it('sums positive linked transactions within the trailing window', () => {
    const txns = [
      txn({ id: 1, amount: 200, propertyId: 7, date: '2026-03-01' }),
      txn({ id: 2, amount: 150, propertyId: 7, date: '2025-01-01' }), // too old
      txn({ id: 3, amount: 80, propertyId: 9, date: '2026-03-01' }),  // other property
    ];
    expect(rollingExpense(txns, { propertyId: 7 }, 12, cats, new Date('2026-03-15T00:00:00Z')))
      .toBe(200);
  });

  it('excludes a pending reimbursable linked transaction', () => {
    // A transaction that is reimbursable but not yet reimbursed must be excluded
    const txns = [
      txn({ id: 1, amount: 300, propertyId: 7, date: '2026-03-01', reimbursable: true, reimbursedAt: null }),
      txn({ id: 2, amount: 200, propertyId: 7, date: '2026-03-01', reimbursable: false }),
    ];
    // Only the non-reimbursable $200 should count
    expect(rollingExpense(txns, { propertyId: 7 }, 12, cats, new Date('2026-03-15T00:00:00Z')))
      .toBe(200);
  });

  it('counts a reimbursed transaction at its net out-of-pocket amount', () => {
    // Paid $500, employer reimbursed $400 → net out-of-pocket $100
    const txns = [
      txn({
        id: 1, amount: 500, propertyId: 7, date: '2026-03-01',
        reimbursable: true, reimbursedAt: '2026-03-10', reimbursedAmount: 400,
      }),
    ];
    expect(rollingExpense(txns, { propertyId: 7 }, 12, cats, new Date('2026-03-15T00:00:00Z')))
      .toBe(100);
  });

  it('excludes transactions in an INCOME-typed category', () => {
    const incomeCat = cat(99, false, 'INCOME');
    const mixedCats = [...cats, incomeCat];
    const txns = [
      txn({ id: 1, amount: 500, propertyId: 7, date: '2026-03-01', categoryId: 99 }), // INCOME
      txn({ id: 2, amount: 200, propertyId: 7, date: '2026-03-01', categoryId: 11 }), // regular NEED
    ];
    // Only the $200 NEED should count
    expect(rollingExpense(txns, { propertyId: 7 }, 12, mixedCats, new Date('2026-03-15T00:00:00Z')))
      .toBe(200);
  });
});
