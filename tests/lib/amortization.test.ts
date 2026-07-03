import { describe, it, expect } from 'vitest';
import { amortize, nextPaymentDateFrom } from '@/lib/amortization';
import { loanBalanceHistory } from '@/lib/loan-history';
import type { Loan } from '@/types/schema';
import { LoanType } from '@/types/enums';

describe('amortize', () => {
  it('computes a standard 30-year fixed mortgage', () => {
    const result = amortize({
      principal: 400000,
      annualRatePct: 0.06,    // 6% APR
      termMonths: 360,
      firstPaymentDate: '2024-06-01',
      extraPayment: 0,
    });
    expect(result.monthlyPayment).toBeCloseTo(2398.20, 1);
    // Analytic: M*n - P where M = P*r / (1 - (1+r)^-n), r=0.06/12, n=360, P=400000.
    expect(result.totalInterest).toBeCloseTo(463352.76, 1);
    expect(result.schedule.length).toBe(360);
    expect(result.schedule[0].principal + result.schedule[0].interest).toBeCloseTo(2398.20, 1);
    expect(result.schedule[359].balance).toBeCloseTo(0, 1);
  });

  it('shortens payoff with extra payments', () => {
    const noExtra = amortize({
      principal: 200000, annualRatePct: 0.05, termMonths: 360,
      firstPaymentDate: '2024-01-01', extraPayment: 0,
    });
    const withExtra = amortize({
      principal: 200000, annualRatePct: 0.05, termMonths: 360,
      firstPaymentDate: '2024-01-01', extraPayment: 200,
    });
    expect(withExtra.schedule.length).toBeLessThan(noExtra.schedule.length);
    expect(withExtra.totalInterest).toBeLessThan(noExtra.totalInterest);
  });

  it('handles 0% loans without dividing by zero', () => {
    const result = amortize({
      principal: 12000, annualRatePct: 0, termMonths: 12,
      firstPaymentDate: '2024-01-01', extraPayment: 0,
    });
    expect(result.monthlyPayment).toBe(1000);
    expect(result.totalInterest).toBe(0);
    expect(result.schedule[0].principal).toBe(1000);
    expect(result.schedule[0].interest).toBe(0);
  });

  it('rejects negative principal', () => {
    expect(() => amortize({
      principal: -100, annualRatePct: 0.05, termMonths: 12,
      firstPaymentDate: '2024-01-01', extraPayment: 0,
    })).toThrow();
  });

  it('clamps end-of-month firstPaymentDate to last day of shorter months', () => {
    const result = amortize({
      principal: 100000,
      annualRatePct: 0.05,
      termMonths: 6,
      firstPaymentDate: '2024-01-31',
      extraPayment: 0,
    });
    expect(result.schedule.map((s) => s.paymentDate)).toEqual([
      '2024-01-31',
      '2024-02-29', // leap year — clamped from 31
      '2024-03-31',
      '2024-04-30', // clamped from 31
      '2024-05-31',
      '2024-06-30', // clamped from 31
    ]);
  });
});

describe('amortize with an explicit contract monthlyPayment', () => {
  it('uses the provided payment instead of re-deriving one', () => {
    const out = amortize({
      principal: 10000,
      annualRatePct: 0.06,
      termMonths: 360,
      firstPaymentDate: '2026-08-01',
      extraPayment: 0,
      monthlyPayment: 500,
    });
    expect(out.monthlyPayment).toBe(500);
    // First month: interest = 10000 * 0.005 = 50; principal = 450.
    expect(out.schedule[0].interest).toBeCloseTo(50, 2);
    expect(out.schedule[0].principal).toBeCloseTo(450, 2);
  });

  it('derives the payment when monthlyPayment is omitted or 0 (backward compatible)', () => {
    const base = {
      principal: 400000,
      annualRatePct: 0.06,
      termMonths: 360,
      firstPaymentDate: '2024-06-01',
      extraPayment: 0,
    };
    expect(amortize(base).monthlyPayment).toBeCloseTo(2398.2, 1);
    expect(amortize({ ...base, monthlyPayment: 0 }).monthlyPayment).toBeCloseTo(2398.2, 1);
  });

  it('ORACLE: remaining interest for a seasoned loan (probe: $400k/30y/6% at 7y in) within $1 of the closed form', () => {
    const r = 0.06 / 12;
    // Contract payment and balance after 84 payments, computed independently
    // of the lib (standard annuity closed forms).
    const pmt = (400000 * r) / (1 - Math.pow(1 + r, -360)); // ≈ 2398.20
    const growth = Math.pow(1 + r, 84);
    const balanceNow = 400000 * growth - (pmt * (growth - 1)) / r; // ≈ 358,558.70
    // The remaining 276 contract payments exactly amortize balanceNow, so
    // true remaining interest = payments − principal.
    const expectedRemainingInterest = 276 * pmt - balanceNow; // ≈ 303,344

    const out = amortize({
      principal: balanceNow,
      annualRatePct: 0.06,
      termMonths: 360, // stays the ORIGINAL term — a safety cap, not the driver
      firstPaymentDate: '2026-08-01',
      extraPayment: 0,
      monthlyPayment: pmt,
    });

    // Payoff in ~276 payments (float residue may add/remove a final cent row).
    expect(out.schedule.length).toBeGreaterThanOrEqual(275);
    expect(out.schedule.length).toBeLessThanOrEqual(277);
    expect(Math.abs(out.totalInterest - expectedRemainingInterest)).toBeLessThanOrEqual(1);
    // The re-derive bug produced ~$415k here; the honest figure is ~$303k.
    expect(out.totalInterest).toBeGreaterThan(300_000);
    expect(out.totalInterest).toBeLessThan(306_000);
  });

  it('a below-interest contract payment cannot loop forever (safety cap, no payoff)', () => {
    const out = amortize({
      principal: 100000,
      annualRatePct: 0.06,
      termMonths: 12,
      firstPaymentDate: '2026-08-01',
      extraPayment: 0,
      monthlyPayment: 100, // < first month's interest ($500): negative amortization
    });
    expect(out.schedule.length).toBe(12 + 360); // termMonths + safety margin
    expect(out.schedule[out.schedule.length - 1].balance).toBeGreaterThan(100000);
  });

  it('CONSISTENCY: forward schedule and loanBalanceHistory back-walk meet within tolerance', () => {
    const r = 0.06 / 12;
    const pmt = (400000 * r) / (1 - Math.pow(1 + r, -360));
    const balanceNow = 358558.7; // ~7y into the probe loan
    const forward = amortize({
      principal: balanceNow,
      annualRatePct: 0.06,
      termMonths: 360,
      firstPaymentDate: '2026-08-01',
      extraPayment: 0,
      monthlyPayment: pmt,
    });
    const balanceIn12Months = forward.schedule[11].balance;

    const loan: Loan = {
      id: 1,
      householdId: 1,
      obligorPersonId: null,
      name: 'Probe mortgage',
      type: LoanType.MORTGAGE,
      originalAmount: 400000,
      currentBalance: balanceIn12Months,
      interestRate: 0.06,
      termMonths: 360,
      firstPaymentDate: '2019-08-01',
      monthlyPayment: pmt,
      extraPaymentDefault: 0,
      linkedPropertyId: null,
      linkedVehicleId: null,
    };
    // Anchor the walk 12 months in the future of the forward start and walk
    // back to it. loanBalanceHistory charges interest on the ENDING balance
    // (a documented backward approximation), diverging ~r·(pmt − r·B) ≈ $3
    // per month from the exact forward schedule → ≤ $50 over 12 months.
    const walked = loanBalanceHistory(loan, '2026-07-31', '2027-07-31', 'MONTH', '2027-07-31');
    expect(Math.abs(walked[0].balance - balanceNow)).toBeLessThan(50);
  });
});

describe('nextPaymentDateFrom', () => {
  it('returns the next scheduled payment date on-or-after today', () => {
    expect(nextPaymentDateFrom('2019-08-15', '2026-07-03')).toBe('2026-07-15');
    expect(nextPaymentDateFrom('2019-08-15', '2026-07-20')).toBe('2026-08-15');
  });

  it('today itself counts as the next payment when it is a payment day', () => {
    expect(nextPaymentDateFrom('2020-05-10', '2026-05-10')).toBe('2026-05-10');
  });

  it('clamps the day-of-month like the schedule does (Jan-31 → Feb-28)', () => {
    expect(nextPaymentDateFrom('2026-01-31', '2026-02-15')).toBe('2026-02-28');
  });

  it('a future firstPaymentDate returns itself', () => {
    expect(nextPaymentDateFrom('2027-01-01', '2026-07-03')).toBe('2027-01-01');
  });
});
