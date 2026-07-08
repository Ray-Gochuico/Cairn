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

describe('never-pays-off cap guard (wave-7 W1)', () => {
  // $18,400 @ 5.9% → ~$90.50/mo interest; an $80 contract payment loses
  // ground every month, so both amortize() and the windowed own-loop run to
  // the termMonths+360 safety cap with principal still owing.
  const underwater = { ...loan, monthlyPayment: 80 };

  it('flags both sides capped when the contract payment is below interest (extra 0)', () => {
    const p = previewExtraLoanPayment(underwater, 0);
    expect(p.capped).toBe(true);
    expect(p.baselineCapped).toBe(true);
  });

  it('a rescuing unbounded extra clears capped but keeps baselineCapped', () => {
    // $80 + $300 nets ~$290/mo of paydown at the start — amortizes in ~56 mo.
    const p = previewExtraLoanPayment(underwater, 300);
    expect(p.capped).toBe(false);
    expect(p.baselineCapped).toBe(true);
  });

  it('a windowed rescue that ends too early stays capped (own-loop detection)', () => {
    // 12 months of +$300 dents the balance (~$14.9k) but the $80 payment then
    // needs ~500 more months — past the 402-month cap. Never pays off at
    // this payment + window.
    const p = previewExtraLoanPayment(underwater, 300, { start: '2027-01-01', end: '2027-12-01' });
    expect(p.capped).toBe(true);
    expect(p.baselineCapped).toBe(true);
  });

  it('a healthy loan reports neither flag (unbounded and windowed)', () => {
    expect(previewExtraLoanPayment(loan, 300).capped).toBe(false);
    expect(previewExtraLoanPayment(loan, 300).baselineCapped).toBe(false);
    const windowed = previewExtraLoanPayment(loan, 300, { start: '2027-01-01', end: '2027-12-01' });
    expect(windowed.capped).toBe(false);
  });

  it('the baseline uses the CONTRACT payment, not a re-derived term payment', () => {
    // The contract $425 is below the ~$486 a 42-month payoff needs, so the
    // honest baseline lands ~49 payments out — strictly AFTER the term-end
    // month (2026-05 + 41 = 2029-10) the old derived-payment baseline
    // reported. Lexical compare works on YYYY-MM.
    const p = previewExtraLoanPayment(loan, 0);
    expect(p.baselinePayoffMonthISO > '2029-10').toBe(true);
    expect(p.baselineCapped).toBe(false); // longer, but it DOES amortize
  });

  it('a zero-balance loan previews without throwing and is not capped', () => {
    const p = previewExtraLoanPayment({ ...loan, currentBalance: 0 }, 100);
    expect(p.capped).toBe(false);
    expect(p.baselineCapped).toBe(false);
    expect(p.monthsSaved).toBe(0);
  });
});
