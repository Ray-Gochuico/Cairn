import { describe, it, expect } from 'vitest';
import { apyToApr, compoundInterestSeries, type CompoundFrequency } from '@/lib/compound-interest';

describe('compoundInterestSeries', () => {
  it('zero rate yields linear PV + PMT × months', () => {
    const r = compoundInterestSeries({
      pv: 1000, monthlyContribution: 100, annualRate: 0, years: 2, frequency: 'MONTHLY',
    });
    expect(r.finalMid).toBeCloseTo(1000 + 100 * 24, 2);
    expect(r.totalContributed).toBeCloseTo(1000 + 100 * 24, 2);
    expect(r.totalInterestMid).toBeCloseTo(0, 2);
  });

  it('$1,000 PV @ 7% monthly × 10 years ≈ $2,009.66 (investor.gov anchor)', () => {
    const r = compoundInterestSeries({
      pv: 1000, monthlyContribution: 0, annualRate: 0.07, years: 10, frequency: 'MONTHLY',
    });
    expect(r.finalMid).toBeCloseTo(2009.66, 0);
  });

  it('zero PMT, pure compound growth with annual frequency', () => {
    // 1000 × (1.07)^10 = 1967.15
    const r = compoundInterestSeries({
      pv: 1000, monthlyContribution: 0, annualRate: 0.07, years: 10, frequency: 'ANNUALLY',
    });
    expect(r.finalMid).toBeCloseTo(1967.15, 0);
  });

  it('variance produces a 3-line band (low < mid < high)', () => {
    const r = compoundInterestSeries({
      pv: 10000, monthlyContribution: 0, annualRate: 0.07, varianceRate: 0.02, years: 10, frequency: 'MONTHLY',
    });
    expect(r.finalLow).toBeLessThan(r.finalMid);
    expect(r.finalMid).toBeLessThan(r.finalHigh);
  });

  it('yearly array has one entry per year, year 1 through years', () => {
    const r = compoundInterestSeries({
      pv: 1000, monthlyContribution: 0, annualRate: 0.05, years: 5, frequency: 'MONTHLY',
    });
    expect(r.yearly).toHaveLength(5);
    expect(r.yearly[0].year).toBe(1);
    expect(r.yearly[4].year).toBe(5);
  });

  it.each<[CompoundFrequency, number]>([
    ['DAILY', 365],
    ['WEEKLY', 52],
    ['MONTHLY', 12],
    ['QUARTERLY', 4],
    ['ANNUALLY', 1],
  ])('%s frequency yields strictly positive growth at 7%%', (frequency) => {
    const r = compoundInterestSeries({
      pv: 1000, monthlyContribution: 0, annualRate: 0.07, years: 1, frequency,
    });
    expect(r.finalMid).toBeGreaterThan(1000);
  });

  it('omitting varianceRate makes low = mid = high', () => {
    const r = compoundInterestSeries({
      pv: 1000, monthlyContribution: 0, annualRate: 0.07, years: 5, frequency: 'MONTHLY',
    });
    expect(r.finalLow).toBeCloseTo(r.finalMid, 6);
    expect(r.finalMid).toBeCloseTo(r.finalHigh, 6);
  });
});

describe('apyToApr', () => {
  it('annual (ppy=1) returns the APY unchanged', () => {
    expect(apyToApr(0.07, 1)).toBe(0.07);
  });
  it('0% APY → 0 APR', () => {
    expect(apyToApr(0, 12)).toBe(0);
  });
  it('the derived APR compounded ppy times reproduces the APY', () => {
    const apr = apyToApr(0.07, 12);
    expect((1 + apr / 12) ** 12 - 1).toBeCloseTo(0.07, 10);
    expect(apr).toBeLessThan(0.07); // monthly APR < its APY
  });
});
