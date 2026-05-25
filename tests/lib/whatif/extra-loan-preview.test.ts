import { describe, it, expect } from 'vitest';
import { previewExtraLoanPayment } from '@/lib/whatif/extra-loan-preview';

const loan = {
  id: 1, name: 'Auto',
  currentBalance: 18400, interestRate: 0.059, monthlyPayment: 425,
  termMonths: 42,
  firstPaymentDate: '2026-05-01',
};

describe('previewExtraLoanPayment', () => {
  it('returns baseline payoff month when extraMonthly = 0', () => {
    const p = previewExtraLoanPayment(loan, 0);
    expect(p.payoffMonthISO).toBe(p.baselinePayoffMonthISO);
    expect(p.monthsSaved).toBe(0);
    expect(p.interestSaved).toBeCloseTo(0, 0);
  });

  it('positive extraMonthly accelerates payoff', () => {
    const p = previewExtraLoanPayment(loan, 300);
    expect(p.monthsSaved).toBeGreaterThan(0);
    expect(p.payoffMonthISO < p.baselinePayoffMonthISO).toBe(true);
    expect(p.interestSaved).toBeGreaterThan(0);
  });

  it('honors a bounded window — start/end shorten the active interval', () => {
    const p = previewExtraLoanPayment(loan, 300, { start: '2027-01-01', end: '2028-12-01' });
    const unbounded = previewExtraLoanPayment(loan, 300);
    expect(p.monthsSaved).toBeGreaterThan(0);
    expect(p.monthsSaved).toBeLessThan(unbounded.monthsSaved);
  });

  it('returns monthsSaved >= 0 when extraMonthly is greater than the balance', () => {
    const tiny = { ...loan, currentBalance: 50, monthlyPayment: 100 };
    const p = previewExtraLoanPayment(tiny, 10000);
    expect(p.monthsSaved).toBeGreaterThanOrEqual(0);
  });
});
