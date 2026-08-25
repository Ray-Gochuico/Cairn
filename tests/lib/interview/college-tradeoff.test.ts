import { describe, it, expect } from 'vitest';
import { computeCollegeTarget, project529Real } from '@/lib/interview/college-tradeoff';

describe('computeCollegeTarget (REAL dollars, D-T3-12 four growing years)', () => {
  it('hand pin: $26,000/yr, 2%/yr real, start in 96 months', () => {
    // 26,000 × (1.02^8 + 1.02^9 + 1.02^10 + 1.02^11)
    //   = 26,000 × (1.17165938 + 1.19509257 + 1.21899442 + 1.24337431)
    //   = 26,000 × 4.82912068 = 125,557.14
    const t = computeCollegeTarget({ annualTodayDollars: 26_000, realGrowthPctPerYear: 2, startMonthsAhead: 96 });
    expect(Math.abs(t - 125_557.14)).toBeLessThan(1);
  });

  it('hand pin, fractional years: $20,000/yr, 3%/yr real, start in 30 months', () => {
    // years = 2.5; 20,000 × 1.03^2.5 × (1 + 1.03 + 1.03² + 1.03³)... computed per-year:
    // 21,533.92 + 22,179.93 + 22,845.33 + 23,530.69 = 90,089.87
    const t = computeCollegeTarget({ annualTodayDollars: 20_000, realGrowthPctPerYear: 3, startMonthsAhead: 30 });
    expect(Math.abs(t - 90_089.87)).toBeLessThan(1);
  });

  it('start now (already 18): today-priced four years, still growing years 2–4', () => {
    // 26,000 × (1 + 1.02 + 1.0404 + 1.061208) = 26,000 × 4.121608 = 107,161.81
    const t = computeCollegeTarget({ annualTodayDollars: 26_000, realGrowthPctPerYear: 2, startMonthsAhead: 0 });
    expect(Math.abs(t - 107_161.81)).toBeLessThan(1);
  });
});

describe('project529Real (Fisher real growth — the nominal-on-real guard)', () => {
  const input = {
    balanceTodayDollars: 10_000, monthlyDollars: 500, months: 120,
    nominalAnnualRate: 0.05, annualInflation: 0.03,
  };

  it('HISTORICAL ANCHOR (nominal-on-real class): 10y of $500/mo on $10k at 5% nominal / 3% inflation is ≈ $78,225 REAL', () => {
    // realAnnual = 1.05/1.03 − 1 = 0.019417476; growth = (1.05/1.03)^10 = 1.21205058
    // monthly i = 1.019417476^(1/12) − 1 = 0.001603898
    // fv = 10,000×1.21205058 + 500×(0.21205058/0.001603898) = 12,120.51 + 66,104.75 = 78,225.25
    const fv = project529Real(input);
    expect(Math.abs(fv - 78_225.25)).toBeLessThan(0.5);
  });

  it('ANTI-PIN: the nominal blend (≈ $93,471) must NOT be produced', () => {
    // Compounding at the raw 5% nominal gives 16,288.95 + 77,181.58 ≈ 93,470.53 —
    // the exact bug class this repo shipped 3×. Real must land far below it.
    expect(project529Real(input)).toBeLessThan(85_000);
  });

  it('nominal == inflation ⇒ zero real rate ⇒ exact arithmetic sum', () => {
    const fv = project529Real({ ...input, nominalAnnualRate: 0.03, annualInflation: 0.03 });
    expect(fv).toBe(10_000 + 500 * 120);
  });

  it('zero months ⇒ the balance unchanged', () => {
    expect(project529Real({ ...input, months: 0 })).toBe(10_000);
  });
});
