import { describe, it, expect } from 'vitest';
import { yearsToFi, financialIndependenceSeries } from '@/lib/financial-independence';

describe('yearsToFi', () => {
  it('returns 0 when already at target', () => {
    expect(yearsToFi({ pv: 1_000_000, pmt: 0, annualRate: 0.06, targetFv: 1_000_000 })).toBe(0);
  });

  it('returns a finite number when contributions + growth reach target', () => {
    // $100k starting, $1k/mo, 6% growth, target $1M -> ~26 years
    const years = yearsToFi({ pv: 100_000, pmt: 12_000, annualRate: 0.06, targetFv: 1_000_000 });
    expect(years).toBeGreaterThan(20);
    expect(years).toBeLessThan(35);
  });

  it("returns Infinity when contributions are zero and growth can't reach target", () => {
    expect(yearsToFi({ pv: 100, pmt: 0, annualRate: 0, targetFv: 1_000_000 })).toBe(Infinity);
  });

  it('handles 0% growth as linear', () => {
    // $0 starting, $10k/yr, target $100k -> 10 years
    expect(yearsToFi({ pv: 0, pmt: 10_000, annualRate: 0, targetFv: 100_000 })).toBeCloseTo(10, 1);
  });

  // Bonus tests
  it('returns Infinity when pmt is negative (withdrawal) and growth cannot keep up', () => {
    // Withdrawing $50k/yr from $100k at 0% growth - target $1M is unreachable
    const years = yearsToFi({ pv: 100_000, pmt: -50_000, annualRate: 0, targetFv: 1_000_000 });
    expect(years).toBe(Infinity);
  });

  it('returns Infinity when pv is high but rate is negative and pmt is zero', () => {
    // Portfolio shrinks each year, no contributions -> never reaches target above pv
    const years = yearsToFi({ pv: 500_000, pmt: 0, annualRate: -0.05, targetFv: 1_000_000 });
    expect(years).toBe(Infinity);
  });
});

describe('financialIndependenceSeries', () => {
  it('returns one entry per growth scenario', () => {
    const result = financialIndependenceSeries({
      pv: 100_000,
      annualContribution: 24_000,
      targetFv: 1_000_000,
      scenarios: [
        { label: 'Conservative', rate: 0.05 },
        { label: 'Moderate', rate: 0.06 },
        { label: 'Optimistic', rate: 0.07 },
        { label: 'Bull', rate: 0.08 },
      ],
    });
    expect(result).toHaveLength(4);
    expect(result[0].label).toBe('Conservative');
    expect(result[0].years).toBeGreaterThan(result[3].years); // higher growth -> fewer years
  });

  // Bonus test
  it('returns [] for an empty scenarios array', () => {
    const result = financialIndependenceSeries({
      pv: 100_000,
      annualContribution: 24_000,
      targetFv: 1_000_000,
      scenarios: [],
    });
    expect(result).toEqual([]);
  });
});
