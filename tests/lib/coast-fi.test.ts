import { describe, it, expect } from 'vitest';
import { coastFi } from '@/lib/coast-fi';

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
});
