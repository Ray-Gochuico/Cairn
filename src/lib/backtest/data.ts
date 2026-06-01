import { loadShillerAnnual } from '@/data/shiller-schema';

/**
 * Blended REAL annual return for a calendar year given the stock weight.
 * Bonds = 1 - stockPct. Implicit annual rebalance (the blend is recomputed
 * fresh each year). Real returns are used directly (the engine is driven in
 * real dollars), so CPI is NOT re-applied downstream.
 */
export function blendedRealReturn(year: number, stockPct: number): number {
  const row = loadShillerAnnual().find((r) => r.year === year);
  if (!row) throw new Error(`No Shiller data for year ${year}`);
  return stockPct * row.sp500RealReturn + (1 - stockPct) * row.tenYearTreasuryReturn;
}

// B5 — NO `annualInflation` export. The real-dollar engine drives real returns
// with a zero inflation override (it never re-applies CPI), so a y/y CPI helper
// would be dead code. If a future nominal-mode variant needs it, add it then
// (YAGNI). Do not export it "for completeness".

/**
 * Start years that have a full `horizonYears` of data available. Inclusive
 * accounting: a start year Y needs data through Y + horizonYears - 1.
 */
export function availableStartYears(horizonYears: number): number[] {
  const rows = loadShillerAnnual();
  const last = rows[rows.length - 1].year;
  return rows
    .map((r) => r.year)
    .filter((y) => y + horizonYears - 1 <= last);
}
