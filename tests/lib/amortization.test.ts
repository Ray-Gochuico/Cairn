import { describe, it, expect } from 'vitest';
import { amortize } from '@/lib/amortization';

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
