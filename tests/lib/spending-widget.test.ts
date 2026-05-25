import { describe, it, expect } from 'vitest';
import { rangeBounds, summarizeSpendingForRange } from '@/lib/spending-widget';
import { CategoryType } from '@/types/enums';
import type { Category, Transaction } from '@/types/schema';

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: over.id ?? 1,
    householdId: over.householdId ?? 1,
    date: over.date ?? '2026-05-10',
    merchant: over.merchant ?? 'ACME',
    merchantRaw: over.merchantRaw ?? null,
    amount: over.amount ?? 50,
    categoryId: over.categoryId ?? null,
    sourceAccountId: over.sourceAccountId ?? null,
    propertyId: over.propertyId ?? null,
    vehicleId: over.vehicleId ?? null,
    personId: over.personId ?? null,
    sourcePdfFilename: over.sourcePdfFilename ?? null,
    reimbursable: over.reimbursable ?? false,
    reimbursedAt: over.reimbursedAt ?? null,
    reimbursedAmount: over.reimbursedAmount ?? null,
    isRecurring: over.isRecurring ?? false,
    notes: over.notes ?? null,
  };
}

function cat(over: Partial<Category> & { id: number; name: string; type?: CategoryType }): Category {
  return {
    id: over.id,
    name: over.name,
    parentCategoryId: over.parentCategoryId ?? null,
    color: over.color ?? null,
    icon: over.icon ?? null,
    type: over.type ?? CategoryType.WANT,
    isCapital: over.isCapital ?? false,
    systemManaged: over.systemManaged ?? false,
    monthlyBudget: over.monthlyBudget ?? null,
  };
}

describe('rangeBounds', () => {
  // 2026-05-25 anchor matches "today" in the conversation context — picked
  // to surface edge cases at the end of the month.
  const asOf = new Date(Date.UTC(2026, 4, 25)); // 2026-05-25

  it('this-month covers the first → last day of the anchor month', () => {
    expect(rangeBounds('this-month', asOf)).toEqual({
      startInclusive: '2026-05-01',
      endInclusive: '2026-05-31',
    });
  });

  it('last-month covers the prior calendar month', () => {
    expect(rangeBounds('last-month', asOf)).toEqual({
      startInclusive: '2026-04-01',
      endInclusive: '2026-04-30',
    });
  });

  it('last-30 covers a rolling 30-day window ending today', () => {
    const b = rangeBounds('last-30', asOf);
    expect(b.endInclusive).toBe('2026-05-25');
    expect(b.startInclusive).toBe('2026-04-26');
  });

  it('ytd covers Jan 1 through the anchor date inclusive', () => {
    expect(rangeBounds('ytd', asOf)).toEqual({
      startInclusive: '2026-01-01',
      endInclusive: '2026-05-25',
    });
  });

  it('last-12 covers a rolling 12-month window ending today', () => {
    const b = rangeBounds('last-12', asOf);
    expect(b.endInclusive).toBe('2026-05-25');
    expect(b.startInclusive).toBe('2025-05-26');
  });
});

describe('summarizeSpendingForRange', () => {
  const foodCat = cat({ id: 1, name: 'Food', color: '#ff0000' });
  const travelCat = cat({ id: 2, name: 'Travel', color: '#00ff00' });
  const incomeCat = cat({ id: 3, name: 'Paycheck', type: CategoryType.INCOME });
  const transferCat = cat({ id: 4, name: 'Transfer', type: CategoryType.TRANSFER });
  const miscCat = cat({ id: 5, name: 'Misc', color: '#888888' });

  const bounds = { startInclusive: '2026-05-01', endInclusive: '2026-05-31' };

  it('groups purchases by category with name + color resolved from the category list', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-02', categoryId: 1, amount: 30 }),
      txn({ id: 2, date: '2026-05-03', categoryId: 1, amount: 20 }),
      txn({ id: 3, date: '2026-05-05', categoryId: 2, amount: 200 }),
    ];
    const result = summarizeSpendingForRange(txns, [foodCat, travelCat], bounds);
    expect(result.total).toBe(250);
    expect(result.byCategory).toHaveLength(2);
    // Sorted by total descending → Travel first.
    expect(result.byCategory[0]).toMatchObject({
      categoryId: 2,
      name: 'Travel',
      color: '#00ff00',
      total: 200,
      count: 1,
    });
    expect(result.byCategory[1]).toMatchObject({
      categoryId: 1,
      name: 'Food',
      color: '#ff0000',
      total: 50,
      count: 2,
    });
  });

  it('drops income and transfer transactions from the totals', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-02', categoryId: 3, amount: 5000 }),  // INCOME
      txn({ id: 2, date: '2026-05-03', categoryId: 4, amount: 1000 }),  // TRANSFER
      txn({ id: 3, date: '2026-05-04', categoryId: 1, amount: 75 }),    // EXPENSE
    ];
    const result = summarizeSpendingForRange(
      txns,
      [foodCat, incomeCat, transferCat],
      bounds,
    );
    expect(result.total).toBe(75);
    expect(result.byCategory.map((c) => c.name)).toEqual(['Food']);
  });

  it('drops transactions outside the inclusive range bounds', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-04-30', categoryId: 1, amount: 100 }), // before
      txn({ id: 2, date: '2026-05-01', categoryId: 1, amount: 50 }),  // first day
      txn({ id: 3, date: '2026-05-31', categoryId: 1, amount: 25 }),  // last day
      txn({ id: 4, date: '2026-06-01', categoryId: 1, amount: 200 }), // after
    ];
    const result = summarizeSpendingForRange(txns, [foodCat], bounds);
    expect(result.total).toBe(75);
    expect(result.byCategory[0].count).toBe(2);
  });

  it('rolls uncategorized purchases into a synthetic "Uncategorized" row', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-10', categoryId: null, amount: 40 }),
      txn({ id: 2, date: '2026-05-11', categoryId: null, amount: 60 }),
      txn({ id: 3, date: '2026-05-12', categoryId: 1, amount: 20 }),
    ];
    const result = summarizeSpendingForRange(txns, [foodCat], bounds);
    const uncategorized = result.byCategory.find((c) => c.categoryId === null);
    expect(uncategorized).toMatchObject({
      name: 'Uncategorized',
      color: null,
      total: 100,
      count: 2,
    });
  });

  it('includes Misc category — Misc exclusion only applies to investment concentration', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-10', categoryId: 5, amount: 12 }),
      txn({ id: 2, date: '2026-05-11', categoryId: 1, amount: 8 }),
    ];
    const result = summarizeSpendingForRange(txns, [foodCat, miscCat], bounds);
    expect(result.byCategory.some((c) => c.name === 'Misc')).toBe(true);
  });

  it('applies an optional accountId filter (excludes other-account transactions)', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-10', categoryId: 1, amount: 30, sourceAccountId: 1 }),
      txn({ id: 2, date: '2026-05-11', categoryId: 1, amount: 40, sourceAccountId: 2 }),
    ];
    const result = summarizeSpendingForRange(
      txns,
      [foodCat],
      bounds,
      { accountId: 1 },
    );
    expect(result.total).toBe(30);
  });

  it('applies a case-insensitive merchant substring filter', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-10', categoryId: 1, amount: 10, merchant: 'STARBUCKS COFFEE' }),
      txn({ id: 2, date: '2026-05-11', categoryId: 1, amount: 25, merchant: 'STARBUCKS' }),
      txn({ id: 3, date: '2026-05-12', categoryId: 1, amount: 99, merchant: 'TARGET' }),
    ];
    const result = summarizeSpendingForRange(
      txns,
      [foodCat],
      bounds,
      { merchantQuery: 'starbucks' },
    );
    expect(result.total).toBe(35);
  });

  it('topByCount returns the category with the most transactions, not the highest spend', () => {
    const txns: Transaction[] = [
      txn({ id: 1, date: '2026-05-10', categoryId: 2, amount: 1000 }), // 1 Travel txn, big spend
      txn({ id: 2, date: '2026-05-11', categoryId: 1, amount: 5 }),
      txn({ id: 3, date: '2026-05-12', categoryId: 1, amount: 6 }),
      txn({ id: 4, date: '2026-05-13', categoryId: 1, amount: 7 }),    // 3 Food txns, small spend
    ];
    const result = summarizeSpendingForRange(txns, [foodCat, travelCat], bounds);
    expect(result.topByCount).toEqual({ name: 'Food', count: 3 });
  });

  it('counts a reimbursed transaction at its net out-of-pocket amount', () => {
    // Charge of $100, reimbursed $80 → contributes $20 to spending totals.
    const txns: Transaction[] = [
      txn({
        id: 1,
        date: '2026-05-10',
        categoryId: 1,
        amount: 100,
        reimbursable: true,
        reimbursedAt: '2026-05-15',
        reimbursedAmount: 80,
      }),
    ];
    const result = summarizeSpendingForRange(txns, [foodCat], bounds);
    expect(result.total).toBe(20);
  });

  it('skips pending-reimbursement transactions entirely', () => {
    // Reimbursable but not yet reimbursed — counted in "Awaiting Reimbursement"
    // pill, not in spending totals.
    const txns: Transaction[] = [
      txn({
        id: 1,
        date: '2026-05-10',
        categoryId: 1,
        amount: 100,
        reimbursable: true,
        reimbursedAt: null,
      }),
    ];
    const result = summarizeSpendingForRange(txns, [foodCat], bounds);
    expect(result.total).toBe(0);
    expect(result.byCategory).toHaveLength(0);
  });

  it('returns an empty summary (zero total, null top) when no transactions match', () => {
    const result = summarizeSpendingForRange([], [foodCat], bounds);
    expect(result.total).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.byCategory).toEqual([]);
    expect(result.topByCount).toBeNull();
  });
});
