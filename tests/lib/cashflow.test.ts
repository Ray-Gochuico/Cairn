import { describe, it, expect } from 'vitest';
import { cashflowWindow } from '@/lib/cashflow';
import type { Transaction } from '@/types/schema';

const txn = (id: number, date: string, amount: number, categoryId: number | null): Transaction => ({
  id, householdId: 1, date, merchant: 'X', merchantRaw: 'X', amount, categoryId,
  sourceAccountId: null, propertyId: null, vehicleId: null, sourcePdfFilename: null,
  reimbursable: false, reimbursedAt: null, reimbursedAmount: null,
  isRecurring: false, notes: null,
});

describe('cashflowWindow', () => {
  it('sums outflow in-window and computes net against the supplied inflow', () => {
    const asOf = new Date('2026-03-30T00:00:00Z');
    const txns = [
      txn(1, '2026-03-20', 100, 33),
      txn(2, '2026-03-25', 50, 32),
      txn(3, '2026-01-01', 999, 33), // outside the 30-day window
      txn(4, '2026-03-26', -500, 41), // a credit — not outflow
    ];
    const cf = cashflowWindow(txns, 4000, 30, asOf);
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
});
