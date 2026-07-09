import { describe, it, expect } from 'vitest';
import { detectRecurring } from '@/lib/recurring';
import type { Transaction, Category } from '@/types/schema';

const txn = (
  id: number,
  merchant: string,
  date: string,
  amount: number,
  categoryId: number | null = 39,
): Transaction => ({
  id, householdId: 1, date, merchant, merchantRaw: merchant, amount,
  categoryId, sourceAccountId: null, propertyId: null, vehicleId: null,
  personId: null, sourcePdfFilename: null, reimbursable: false, reimbursedAt: null,
  reimbursedAmount: null, isRecurring: false, notes: null,
});

const cat = (id: number, type: Category['type']): Category => ({
  id, name: `Cat${id}`, parentCategoryId: null, color: null, icon: null,
  type, isCapital: false, systemManaged: false,
});

/** Plain NEED/WANT categories used by all existing test cases. */
const baseCategories: Category[] = [
  cat(39, 'WANT'),
  cat(10, 'NEED'),
];

describe('detectRecurring', () => {
  it('flags a monthly same-amount merchant as recurring', () => {
    const groups = detectRecurring([
      txn(1, 'NETFLIX', '2026-01-09', 15.49),
      txn(2, 'NETFLIX', '2026-02-09', 15.49),
      txn(3, 'NETFLIX', '2026-03-09', 15.49),
    ], baseCategories);
    expect(groups).toHaveLength(1);
    expect(groups[0].merchant).toBe('NETFLIX');
    expect(groups[0].transactionIds).toEqual([1, 2, 3]);
  });
  it('ignores a merchant seen only once', () => {
    expect(detectRecurring([txn(1, 'ONE OFF', '2026-03-01', 50)], baseCategories)).toEqual([]);
  });
  it('ignores wildly varying amounts at the same merchant', () => {
    expect(
      detectRecurring([
        txn(1, 'AMAZON', '2026-01-05', 12),
        txn(2, 'AMAZON', '2026-02-05', 240),
      ], baseCategories),
    ).toEqual([]);
  });
  it('ignores non-monthly cadence', () => {
    expect(
      detectRecurring([
        txn(1, 'GYM', '2026-01-01', 40),
        txn(2, 'GYM', '2026-01-04', 40),
      ], baseCategories),
    ).toEqual([]);
  });

  it('detects recurring when one month is skipped (gap of ~60 days)', () => {
    // Jan 9 → Feb 9 → Apr 9 (Feb→Apr skips March; gap ~59 days ≈ 2 months)
    const groups = detectRecurring([
      txn(1, 'SPOTIFY', '2026-01-09', 9.99),
      txn(2, 'SPOTIFY', '2026-02-09', 9.99),
      txn(3, 'SPOTIFY', '2026-04-09', 9.99),
    ], baseCategories);
    expect(groups).toHaveLength(1);
    expect(groups[0].merchant).toBe('SPOTIFY');
    expect(groups[0].transactionIds).toEqual([1, 2, 3]);
  });

  it('skips credits (amount <= 0) and does not produce a recurring group from them', () => {
    expect(
      detectRecurring([
        txn(1, 'CASHBACK', '2026-01-01', -5),
        txn(2, 'CASHBACK', '2026-02-01', -5),
        txn(3, 'CASHBACK', '2026-03-01', -5),
      ], baseCategories),
    ).toEqual([]);
  });

  it('skips TRANSFER-category charges so debt payments do not appear as subscriptions', () => {
    const transferCat: Category[] = [cat(43, 'TRANSFER')];
    // Three monthly loan autopayments, stable amount — must NOT be flagged recurring
    expect(
      detectRecurring([
        txn(1, 'STUDENT LOAN SERVICER', '2026-01-15', 320.00, 43),
        txn(2, 'STUDENT LOAN SERVICER', '2026-02-15', 320.00, 43),
        txn(3, 'STUDENT LOAN SERVICER', '2026-03-15', 320.00, 43),
      ], transferCat),
    ).toEqual([]);
  });
});

describe('cadence normalization (wave-9 M20)', () => {
  it('a quarterly biller reports cadenceMonths 3 and a ÷3 monthly figure (wave-9 M20)', () => {
    const txns = ['2026-01-05', '2026-04-05', '2026-07-05'].map((date, i) =>
      txn(i + 1, 'Water Utility', date, 90),
    );
    const [g] = detectRecurring(txns, []);
    expect(g.cadenceMonths).toBe(3);
    expect(g.monthlyAmount).toBeCloseTo(30, 6);
    expect(g.averageAmount).toBeCloseTo(90, 6); // per-charge mean unchanged
  });

  it('a monthly biller is unchanged (cadence 1)', () => {
    const txns = ['2026-05-05', '2026-06-05', '2026-07-05'].map((date, i) =>
      txn(i + 1, 'Stream Co', date, 15),
    );
    const [g] = detectRecurring(txns, []);
    expect(g.cadenceMonths).toBe(1);
    expect(g.monthlyAmount).toBeCloseTo(15, 6);
  });
});
