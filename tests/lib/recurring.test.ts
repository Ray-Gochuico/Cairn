import { describe, it, expect } from 'vitest';
import { detectRecurring } from '@/lib/recurring';
import type { Transaction } from '@/types/schema';

const txn = (id: number, merchant: string, date: string, amount: number): Transaction => ({
  id, householdId: 1, date, merchant, merchantRaw: merchant, amount,
  categoryId: 39, sourceAccountId: null, propertyId: null, vehicleId: null,
  sourcePdfFilename: null, reimbursable: false, reimbursedAt: null,
  reimbursedAmount: null, isRecurring: false, notes: null,
});

describe('detectRecurring', () => {
  it('flags a monthly same-amount merchant as recurring', () => {
    const groups = detectRecurring([
      txn(1, 'NETFLIX', '2026-01-09', 15.49),
      txn(2, 'NETFLIX', '2026-02-09', 15.49),
      txn(3, 'NETFLIX', '2026-03-09', 15.49),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].merchant).toBe('NETFLIX');
    expect(groups[0].transactionIds).toEqual([1, 2, 3]);
  });
  it('ignores a merchant seen only once', () => {
    expect(detectRecurring([txn(1, 'ONE OFF', '2026-03-01', 50)])).toEqual([]);
  });
  it('ignores wildly varying amounts at the same merchant', () => {
    expect(
      detectRecurring([
        txn(1, 'AMAZON', '2026-01-05', 12),
        txn(2, 'AMAZON', '2026-02-05', 240),
      ]),
    ).toEqual([]);
  });
  it('ignores non-monthly cadence', () => {
    expect(
      detectRecurring([
        txn(1, 'GYM', '2026-01-01', 40),
        txn(2, 'GYM', '2026-01-04', 40),
      ]),
    ).toEqual([]);
  });
});
