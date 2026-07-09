import { describe, it, expect } from 'vitest';
import { fractionToPercent, percentToFraction } from '@/lib/percent-fields';

describe('percent-fields', () => {
  it('fractionToPercent converts storage fraction to friendly percent', () => {
    expect(fractionToPercent(0.0625)).toBe(6.25);
  });
  it('percentToFraction converts friendly percent to storage fraction', () => {
    expect(percentToFraction(6.25)).toBe(0.0625);
  });
  it('strips float noise', () => {
    expect(fractionToPercent(0.145)).toBe(14.5);
  });
  it('round-trips stably', () => {
    for (const x of [0, 0.04, 0.0625, 0.15, 1]) {
      expect(percentToFraction(fractionToPercent(x))).toBe(x);
    }
  });
});
