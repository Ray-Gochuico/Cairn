import { describe, it, expect } from 'vitest';
import { realRateOf } from '@/lib/calculators/real-rate';

/**
 * Fisher equation: (1 + r_real) = (1 + r_nominal) / (1 + inflation).
 *
 * Every expected value below is hand-derived from that identity (arithmetic
 * shown), NOT echoed from the implementation.
 */
describe('realRateOf', () => {
  it('converts nominal 7% with 2.5% inflation to ~4.390% real', () => {
    // (1.07 / 1.025) - 1 = 1.0439024390... - 1 = 0.0439024390...
    expect(realRateOf(0.07, 0.025)).toBeCloseTo(0.04390244, 8);
  });

  it('converts nominal 5% with 2.5% inflation to ~2.439% real', () => {
    // (1.05 / 1.025) - 1 = 1.0243902439... - 1 = 0.0243902439...
    expect(realRateOf(0.05, 0.025)).toBeCloseTo(0.02439024, 8);
  });

  it('converts nominal 8% with 3% inflation to ~4.854% real', () => {
    // (1.08 / 1.03) - 1 = 1.0485436893... - 1 = 0.0485436893...
    expect(realRateOf(0.08, 0.03)).toBeCloseTo(0.04854369, 8);
  });

  it('returns the nominal rate unchanged when inflation is zero', () => {
    // (1.06 / 1.00) - 1 = 0.06
    expect(realRateOf(0.06, 0)).toBeCloseTo(0.06, 12);
  });

  it('returns a NEGATIVE real rate when inflation exceeds the nominal return', () => {
    // (1.02 / 1.05) - 1 = 0.9714285714... - 1 = -0.0285714285...
    // (No floor — the honest Fisher result; callers decide how to present it.)
    expect(realRateOf(0.02, 0.05)).toBeCloseTo(-0.02857143, 8);
  });

  it('real rate is always strictly below the nominal rate for positive inflation', () => {
    expect(realRateOf(0.07, 0.025)).toBeLessThan(0.07);
    expect(realRateOf(0.05, 0.025)).toBeLessThan(0.05);
  });
});
