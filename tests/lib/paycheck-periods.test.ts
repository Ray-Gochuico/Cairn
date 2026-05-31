import { describe, it, expect } from 'vitest';
import { PaycheckPeriod, PAYCHECK_PERIODS, periodsPerYear, divideAnnualByPeriod } from '@/lib/paycheck-periods';

describe('PAYCHECK_PERIODS', () => {
  it('exposes 8 named periods in descending-frequency order', () => {
    expect(PAYCHECK_PERIODS.map((p) => p.id)).toEqual([
      'ANNUAL',
      'SEMI_ANNUAL',
      'QUARTERLY',
      'MONTHLY',
      'SEMI_MONTHLY',
      'BI_WEEKLY',
      'WEEKLY',
      'DAILY',
    ]);
  });
});

describe('periodsPerYear', () => {
  it('returns the correct integer divisor for each period', () => {
    expect(periodsPerYear('ANNUAL')).toBe(1);
    expect(periodsPerYear('SEMI_ANNUAL')).toBe(2);
    expect(periodsPerYear('QUARTERLY')).toBe(4);
    expect(periodsPerYear('MONTHLY')).toBe(12);
    expect(periodsPerYear('SEMI_MONTHLY')).toBe(24);
    expect(periodsPerYear('BI_WEEKLY')).toBe(26);
    expect(periodsPerYear('WEEKLY')).toBe(52);
    expect(periodsPerYear('DAILY')).toBe(260);
  });
});

describe('divideAnnualByPeriod', () => {
  it('returns the annual value unchanged for ANNUAL', () => {
    expect(divideAnnualByPeriod(120000, 'ANNUAL')).toBe(120000);
  });
  it('divides by 12 for MONTHLY', () => {
    expect(divideAnnualByPeriod(120000, 'MONTHLY')).toBe(10000);
  });
  it('divides by 26 for BI_WEEKLY', () => {
    expect(divideAnnualByPeriod(130000, 'BI_WEEKLY')).toBe(5000);
  });
});
