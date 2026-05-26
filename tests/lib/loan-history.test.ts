import { describe, it, expect } from 'vitest';
import type { Loan } from '@/types/schema';
import { LoanType } from '@/types/enums';
import { loanBalanceHistory } from '@/lib/loan-history';

const mortgage: Loan = {
  id: 1,
  householdId: 1,
  obligorPersonId: null,
  name: 'Test mortgage',
  type: LoanType.MORTGAGE,
  originalAmount: 400000,
  currentBalance: 350000,
  interestRate: 0.04,
  termMonths: 360,
  firstPaymentDate: '2020-06-01',
  monthlyPayment: 1909.66, // 30-year fixed at 4%, $400k principal
  extraPaymentDefault: 0,
  linkedPropertyId: null,
  linkedVehicleId: null,
};

describe('loanBalanceHistory', () => {
  it('returns the current balance for a single-bucket query at "today"', () => {
    const today = new Date().toISOString().slice(0, 10);
    const out = loanBalanceHistory(mortgage, today, today, 'DAY');
    expect(out).toHaveLength(1);
    expect(out[0].balance).toBeCloseTo(350000, 0);
  });

  it('walks backward — balance was higher 12+ months ago', () => {
    // Use a window that includes today as the anchor so the back-walk has somewhere to start.
    const today = new Date();
    const todayISO = today.toISOString().slice(0, 10);
    const oneYearAgo = new Date(
      Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);
    const out = loanBalanceHistory(mortgage, oneYearAgo, todayISO, 'MONTH');
    expect(out.length).toBeGreaterThan(1);
    // Sorted ascending by bucketEnd; the most recent bucket holds currentBalance,
    // earlier buckets walk backward to a HIGHER balance.
    const earliest = out[0];
    const latest = out[out.length - 1];
    expect(earliest.balance).toBeGreaterThan(latest.balance);
  });

  it('returns 0 once the analytical walk goes beyond origination (balance reaches original)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const out = loanBalanceHistory(mortgage, '1990-01-01', today, 'YEAR');
    // Some buckets should have balance == 0 (before the loan existed)
    expect(out.some((b) => b.balance === 0)).toBe(true);
  });

  it('handles a fully-paid loan (currentBalance=0)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const out = loanBalanceHistory(
      { ...mortgage, currentBalance: 0 },
      '2025-01-01',
      today,
      'MONTH',
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((b) => b.balance === 0)).toBe(true);
  });

  it('produces bucket ends sorted ascending', () => {
    const today = new Date().toISOString().slice(0, 10);
    const out = loanBalanceHistory(mortgage, '2024-01-01', today, 'MONTH');
    for (let i = 1; i < out.length; i++) {
      expect(out[i].bucketEnd > out[i - 1].bucketEnd).toBe(true);
    }
  });

  it('holds the balance flat at currentBalance for future buckets (no projection)', () => {
    // Force a window entirely in the future so every bucket is past the anchor.
    const today = new Date();
    const future1 = new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1))
      .toISOString()
      .slice(0, 10);
    const future2 = new Date(Date.UTC(today.getUTCFullYear() + 2, 11, 31))
      .toISOString()
      .slice(0, 10);
    const out = loanBalanceHistory(mortgage, future1, future2, 'YEAR');
    expect(out.length).toBeGreaterThan(0);
    for (const row of out) {
      expect(row.balance).toBeCloseTo(mortgage.currentBalance, 6);
    }
  });
});
