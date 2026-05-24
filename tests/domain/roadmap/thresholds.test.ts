import { describe, it, expect } from 'vitest';
import {
  INTEREST_THRESHOLDS,
  classifyDebtRate,
  getInterestThresholds,
} from '@/domain/roadmap/thresholds';

describe('INTEREST_THRESHOLDS', () => {
  it('uses 5/8 as the default low/high boundaries (percent)', () => {
    expect(INTEREST_THRESHOLDS.low).toBe(5);
    expect(INTEREST_THRESHOLDS.high).toBe(8);
  });
});

describe('getInterestThresholds', () => {
  it('returns defaults when the household has no overrides', () => {
    const r = getInterestThresholds({
      interestThresholdLowPct: null,
      interestThresholdHighPct: null,
    });
    expect(r).toEqual({ low: 5, high: 8 });
  });

  it('honors a low override', () => {
    const r = getInterestThresholds({
      interestThresholdLowPct: 4.5,
      interestThresholdHighPct: null,
    });
    expect(r.low).toBe(4.5);
    expect(r.high).toBe(8);
  });

  it('honors a high override', () => {
    const r = getInterestThresholds({
      interestThresholdLowPct: null,
      interestThresholdHighPct: 10,
    });
    expect(r.low).toBe(5);
    expect(r.high).toBe(10);
  });

  it('honors both overrides simultaneously', () => {
    const r = getInterestThresholds({
      interestThresholdLowPct: 3,
      interestThresholdHighPct: 7,
    });
    expect(r).toEqual({ low: 3, high: 7 });
  });
});

describe('classifyDebtRate', () => {
  const defaults = { low: 5, high: 8 };

  it('classifies just under the low threshold as low', () => {
    expect(classifyDebtRate(4.99, defaults)).toBe('low');
  });

  it('classifies exactly at the low threshold as moderate', () => {
    expect(classifyDebtRate(5, defaults)).toBe('moderate');
  });

  it('classifies just under the high threshold as moderate', () => {
    expect(classifyDebtRate(7.99, defaults)).toBe('moderate');
  });

  it('classifies exactly at the high threshold as high', () => {
    expect(classifyDebtRate(8, defaults)).toBe('high');
  });

  it('classifies far-above-high as high', () => {
    expect(classifyDebtRate(24, defaults)).toBe('high');
  });

  it('classifies zero as low', () => {
    expect(classifyDebtRate(0, defaults)).toBe('low');
  });

  it('respects custom thresholds (10% / 15%)', () => {
    const custom = { low: 10, high: 15 };
    expect(classifyDebtRate(9.99, custom)).toBe('low');
    expect(classifyDebtRate(10, custom)).toBe('moderate');
    expect(classifyDebtRate(14.99, custom)).toBe('moderate');
    expect(classifyDebtRate(15, custom)).toBe('high');
  });
});
