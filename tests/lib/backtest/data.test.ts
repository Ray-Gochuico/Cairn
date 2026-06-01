import { describe, it, expect } from 'vitest';
import { blendedRealReturn, availableStartYears } from '@/lib/backtest/data';
import { loadShillerAnnual } from '@/data/shiller-schema';

describe('blendedRealReturn', () => {
  it('returns 100% equity real return at stockPct=1', () => {
    const rows = loadShillerAnnual();
    const y = rows[10].year;
    expect(blendedRealReturn(y, 1)).toBeCloseTo(rows[10].sp500RealReturn, 10);
  });

  it('returns 100% bond return at stockPct=0', () => {
    const rows = loadShillerAnnual();
    const y = rows[10].year;
    expect(blendedRealReturn(y, 0)).toBeCloseTo(rows[10].tenYearTreasuryReturn, 10);
  });

  it('blends linearly at stockPct=0.5', () => {
    const rows = loadShillerAnnual();
    const r = rows[10];
    expect(blendedRealReturn(r.year, 0.5)).toBeCloseTo(
      0.5 * r.sp500RealReturn + 0.5 * r.tenYearTreasuryReturn,
      10,
    );
  });
});

describe('availableStartYears', () => {
  it('excludes start years without a full horizon of data', () => {
    const rows = loadShillerAnnual();
    const last = rows[rows.length - 1].year;
    const starts = availableStartYears(30);
    // The latest start must leave 30 years of data (inclusive accounting):
    expect(starts[starts.length - 1]).toBeLessThanOrEqual(last - 30 + 1);
    expect(starts[0]).toBe(1871);
  });
});
