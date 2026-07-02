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

  it('honors an injected todayISO for the anchor', () => {
    // Injected today (2026-02-15) is MID-window: the anchor is 2026-01-31
    // (last bucketEnd ≤ injected today). Buckets after it hold flat at
    // currentBalance (no forward projection); buckets before it back-walk
    // HIGHER. A real-clock implementation would anchor at the last bucket
    // (2026-03-31) instead and back-walk 2026-01-31/2026-02-28 above 350000,
    // failing the flat assertions below.
    const out = loanBalanceHistory(mortgage, '2025-11-01', '2026-03-31', 'MONTH', '2026-02-15');
    expect(out.map((b) => b.bucketEnd)).toEqual([
      '2025-11-30',
      '2025-12-31',
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(out[2].balance).toBeCloseTo(350000, 5); // anchor at injected today
    expect(out[3].balance).toBeCloseTo(350000, 5); // future of injected today: flat
    expect(out[4].balance).toBeCloseTo(350000, 5); // future of injected today: flat
    expect(out[0].balance).toBeGreaterThan(350000); // back-walked from the 01-31 anchor
  });

  it('weekly buckets inside one calendar month hold the balance flat', () => {
    // WEEK bucket ends: 2026-05-23, 2026-05-30, 2026-06-06 (anchor).
    const out = loanBalanceHistory(mortgage, '2026-05-20', '2026-06-12', 'WEEK', '2026-06-12');
    expect(out.map((b) => b.bucketEnd)).toEqual(['2026-05-23', '2026-05-30', '2026-06-06']);
    expect(out[2].balance).toBeCloseTo(350000, 0);
    // 05-30 → 06-06 crosses the May→June boundary: exactly one amortization step.
    expect(out[1].balance).toBeGreaterThan(350000);
    // 05-23 → 05-30 stays inside May: no step.
    expect(out[0].balance).toBeCloseTo(out[1].balance, 5);
  });

  it('1Y of WEEK buckets back-walks ~12 months, not ~52', () => {
    const week = loanBalanceHistory(mortgage, '2025-06-12', '2026-06-12', 'WEEK', '2026-06-12');
    const month = loanBalanceHistory(mortgage, '2025-06-12', '2026-06-12', 'MONTH', '2026-06-12');
    // Phase shift between Saturday ends and month ends allows ~1 step of drift;
    // the old bug produced ~$27,000 of drift.
    expect(Math.abs(week[0].balance - month[0].balance)).toBeLessThan(2500);
  });

  it('a nearly-new loan does not spuriously walk past origination on WEEK buckets', () => {
    const nearNew: Loan = { ...mortgage, currentBalance: 396000 };
    const out = loanBalanceHistory(nearNew, '2025-12-12', '2026-06-12', 'WEEK', '2026-06-12');
    // 6 month-boundary crossings ≈ +$3.5k back-walked — well under originalAmount.
    // The old per-week stepping took 26 steps and zeroed the whole window.
    expect(out[0].balance).toBeGreaterThan(0);
  });
});
