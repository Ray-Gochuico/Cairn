import { describe, it, expect } from 'vitest';
import { blendedRealReturn, availableStartYears } from '@/lib/backtest/data';
import { loadShillerAnnual } from '@/data/shiller-schema';

// The bond column is NOMINAL; blendedRealReturn deflates it to real with the
// row's implied inflation (Shiller's own deflation identity from the stock
// columns). Mirror that here so the tests pin the REAL-blend contract rather
// than the prior real-stock/nominal-bond mismatch (which leaked inflation into
// the bond sleeve and flipped the 1966-vs-1929 ordering — see data.ts).
function bondRealReturn(r: { sp500NominalReturn: number; sp500RealReturn: number; tenYearTreasuryReturn: number }): number {
  const inflation = (1 + r.sp500NominalReturn) / (1 + r.sp500RealReturn) - 1;
  return (1 + r.tenYearTreasuryReturn) / (1 + inflation) - 1;
}

describe('blendedRealReturn', () => {
  it('returns 100% equity real return at stockPct=1', () => {
    const rows = loadShillerAnnual();
    const y = rows[10].year;
    expect(blendedRealReturn(y, 1)).toBeCloseTo(rows[10].sp500RealReturn, 10);
  });

  it('returns the REAL (CPI-deflated) bond return at stockPct=0', () => {
    const rows = loadShillerAnnual();
    const r = rows[10];
    expect(blendedRealReturn(r.year, 0)).toBeCloseTo(bondRealReturn(r), 10);
  });

  it('blends linearly at stockPct=0.5 (both legs real)', () => {
    const rows = loadShillerAnnual();
    const r = rows[10];
    expect(blendedRealReturn(r.year, 0.5)).toBeCloseTo(
      0.5 * r.sp500RealReturn + 0.5 * bondRealReturn(r),
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
