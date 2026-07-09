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

  // ── H1: optional `inflation` converts NOMINAL scenario rates to REAL before
  // the years solve (the target is in today's dollars). ────────────────────
  describe('H1 real-rate conversion (inflation param)', () => {
    // Worked example: pv=$100k, pmt=$24k/yr, target=$1M (today's dollars).
    // Nominal 7% solve (no inflation):
    //   pmt/r = 24000/0.07 = 342857.142857
    //   t = ln((1_000_000 + 342857.142857)/(100_000 + 342857.142857)) / ln(1.07)
    //     = ln(1_342_857.142857 / 442_857.142857) / ln(1.07)
    //     = ln(3.0322580645) / 0.0676586485
    //     = 1.1093226 / 0.0676586485 = 16.3957 years
    // Real 7%→(1.07/1.025)−1 = 0.0439024390 solve:
    //   pmt/r = 24000/0.0439024390 = 546_666.9846
    //   t = ln((1_546_666.9846)/(646_666.9846)) / ln(1.0439024390)
    //     = ln(2.392268) / 0.0429655 = 0.8723049 / 0.0429655 = 20.2957 years
    it('nominal 7% vs real (2.5% inflation): years INCREASE 16.40 → 20.30', () => {
      const nominal = financialIndependenceSeries({
        pv: 100_000,
        annualContribution: 24_000,
        targetFv: 1_000_000,
        scenarios: [{ label: 'X', rate: 0.07 }],
      });
      const real = financialIndependenceSeries({
        pv: 100_000,
        annualContribution: 24_000,
        targetFv: 1_000_000,
        scenarios: [{ label: 'X', rate: 0.07 }],
        inflation: 0.025,
      });
      expect(nominal[0].years).toBeCloseTo(16.3957, 3);
      expect(real[0].years).toBeCloseTo(20.2957, 3);
      expect(real[0].years).toBeGreaterThan(nominal[0].years);
    });

    // Nominal 5% → 19.2000 years; real (1.05/1.025)−1 = 0.0243902439 → 25.0838.
    it('nominal 5% vs real (2.5% inflation): years INCREASE 19.20 → 25.08', () => {
      const nominal = financialIndependenceSeries({
        pv: 100_000,
        annualContribution: 24_000,
        targetFv: 1_000_000,
        scenarios: [{ label: 'X', rate: 0.05 }],
      });
      const real = financialIndependenceSeries({
        pv: 100_000,
        annualContribution: 24_000,
        targetFv: 1_000_000,
        scenarios: [{ label: 'X', rate: 0.05 }],
        inflation: 0.025,
      });
      expect(nominal[0].years).toBeCloseTo(19.2000, 3);
      expect(real[0].years).toBeCloseTo(25.0838, 3);
      expect(real[0].years).toBeGreaterThan(nominal[0].years);
    });

    it('preserves the NOMINAL rate in the result (for table display + chart), not the real rate', () => {
      const real = financialIndependenceSeries({
        pv: 100_000,
        annualContribution: 24_000,
        targetFv: 1_000_000,
        scenarios: [{ label: 'X', rate: 0.07 }],
        inflation: 0.025,
      });
      // The displayed/charted rate stays the nominal 7% the user configured.
      expect(real[0].rate).toBe(0.07);
    });

    it('nominal ≤ inflation is UNREACHABLE in real terms → Infinity (matches the unfloored chart)', () => {
      // real rate = (1.02/1.05) - 1 = -2.86% → the real balance plateaus below
      // the today's-dollars target and never reaches it. The pre-T17 floored
      // solve would have shown a finite (optimistic) year count instead.
      const res = financialIndependenceSeries({
        pv: 100_000,
        annualContribution: 24_000,
        targetFv: 1_000_000,
        scenarios: [{ label: 'X', rate: 0.02 }],
        inflation: 0.05,
      });
      expect(res[0].years).toBe(Infinity);
    });

    it('inflation = 0 reproduces the nominal solve exactly', () => {
      const base = financialIndependenceSeries({
        pv: 100_000,
        annualContribution: 24_000,
        targetFv: 1_000_000,
        scenarios: [{ label: 'X', rate: 0.06 }],
      });
      const withZero = financialIndependenceSeries({
        pv: 100_000,
        annualContribution: 24_000,
        targetFv: 1_000_000,
        scenarios: [{ label: 'X', rate: 0.06 }],
        inflation: 0,
      });
      expect(withZero[0].years).toBeCloseTo(base[0].years, 10);
    });
  });
});
