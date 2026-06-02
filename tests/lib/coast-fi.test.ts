import { describe, it, expect } from 'vitest';
import { coastFi } from '@/lib/coast-fi';
import { realRateOf } from '@/lib/calculators/real-rate';

describe('coastFi', () => {
  it('computes the amount needed today to coast to retirement', () => {
    // Need $1M at retirement, 6% growth, 20 years to retirement -> today need ~$311k
    expect(
      coastFi({ requiredAtRetirement: 1_000_000, annualRate: 0.06, yearsUntilRetirement: 20 }),
    ).toBeCloseTo(311805, 0);
  });

  it('returns the target itself when already at retirement', () => {
    expect(
      coastFi({ requiredAtRetirement: 1_000_000, annualRate: 0.06, yearsUntilRetirement: 0 }),
    ).toBe(1_000_000);
  });

  it('returns more than the target for negative years (already retired but underfunded)', () => {
    expect(
      coastFi({ requiredAtRetirement: 1_000_000, annualRate: 0.06, yearsUntilRetirement: -1 }),
    ).toBeGreaterThan(1_000_000);
  });

  // Bonus tests
  it('returns the target itself for 0% rate regardless of years', () => {
    expect(
      coastFi({ requiredAtRetirement: 1_000_000, annualRate: 0, yearsUntilRetirement: 30 }),
    ).toBe(1_000_000);
    expect(
      coastFi({ requiredAtRetirement: 500_000, annualRate: 0, yearsUntilRetirement: 5 }),
    ).toBe(500_000);
  });

  it('computes ~$131k today for 30 years at 7% rate with $1M target', () => {
    expect(
      coastFi({ requiredAtRetirement: 1_000_000, annualRate: 0.07, yearsUntilRetirement: 30 }),
    ).toBeCloseTo(131367, 0);
  });

  it('returns a very small amount (<< target) when overfunded with long horizon', () => {
    // $100 target, 50 years, 7% rate -> today need a tiny fraction of $100
    const result = coastFi({
      requiredAtRetirement: 100,
      annualRate: 0.07,
      yearsUntilRetirement: 50,
    });
    expect(result).toBeLessThan(100);
    expect(result).toBeLessThan(5);
  });

  // ── H1: discounting a today's-$ (REAL) target by a REAL rate yields a higher
  // coast-needed-today than the (buggy) nominal-rate discount. ───────────────
  describe('H1 real-rate discount (today\'s-dollars target)', () => {
    // Worked example: target $1.5M (today's $), 25 years to retirement.
    // Nominal 7% discount: 1_500_000 / 1.07^25
    //   1.07^25 = 5.42743 → 1_500_000 / 5.42743 = $276,373.77
    // Real 7%→(1.07/1.025)−1 = 0.0439024390 discount:
    //   1.0439024390^25 = 2.92750 → 1_500_000 / 2.92750 = $512,381.51
    it('nominal 7% vs real (2.5% inflation): coast-needed INCREASES $276,374 → $512,382', () => {
      const nominal = coastFi({
        requiredAtRetirement: 1_500_000,
        annualRate: 0.07,
        yearsUntilRetirement: 25,
      });
      const real = coastFi({
        requiredAtRetirement: 1_500_000,
        annualRate: realRateOf(0.07, 0.025),
        yearsUntilRetirement: 25,
      });
      expect(nominal).toBeCloseTo(276373.77, 1);
      expect(real).toBeCloseTo(512381.51, 1);
      expect(real).toBeGreaterThan(nominal);
    });

    // target $1.5M, 25 years, nominal 6% → 349,497.95 ; real (1.06/1.025)−1 → 647,949.65
    it('nominal 6% vs real (2.5% inflation): coast-needed INCREASES $349,498 → $647,950', () => {
      const nominal = coastFi({
        requiredAtRetirement: 1_500_000,
        annualRate: 0.06,
        yearsUntilRetirement: 25,
      });
      const real = coastFi({
        requiredAtRetirement: 1_500_000,
        annualRate: realRateOf(0.06, 0.025),
        yearsUntilRetirement: 25,
      });
      expect(nominal).toBeCloseTo(349497.95, 1);
      expect(real).toBeCloseTo(647949.65, 1);
      expect(real).toBeGreaterThan(nominal);
    });
  });
});
