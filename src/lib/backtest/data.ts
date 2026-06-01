import { loadShillerAnnual } from '@/data/shiller-schema';

/**
 * Real annual return of the bond sleeve for a calendar year.
 *
 * The Shiller asset stores `tenYearTreasuryReturn` as a NOMINAL long-government
 * total return (see src/data/shiller.ts derivation note), whereas
 * `sp500RealReturn` is already CPI-deflated. Blending a real stock leg with a
 * nominal bond leg and calling the sum "real" leaks that year's inflation into
 * the bond sleeve — the Coast-FI nominal-on-real bug class (the same one BT-2
 * guards against on the cash path). Left uncorrected it overstates real wealth
 * by ~(1-stockPct)*inflation per year, which in high-inflation regimes flips
 * the canonical ordering (e.g. the 1966 cohort — historically the worst-ever
 * 30y start — would rank ABOVE 1929).
 *
 * We deflate the nominal bond return to real with that year's implied inflation,
 * derived from the row's OWN stock columns via Shiller's deflation identity
 * `(1 + sp500NominalReturn)/(1 + sp500RealReturn) - 1`. This needs no next-row
 * CPI lookup (so it is exact even for the terminal year), uses the same
 * deflation Shiller applied to the stock series, and matches the CPI-column
 * y/y inflation to within rounding (<2e-5 across all years).
 */
function bondRealReturn(row: { sp500NominalReturn: number; sp500RealReturn: number; tenYearTreasuryReturn: number }): number {
  const inflation = (1 + row.sp500NominalReturn) / (1 + row.sp500RealReturn) - 1;
  return (1 + row.tenYearTreasuryReturn) / (1 + inflation) - 1;
}

/**
 * Blended REAL annual return for a calendar year given the stock weight.
 * Bonds = 1 - stockPct. Implicit annual rebalance (the blend is recomputed
 * fresh each year). Both legs are REAL (the stock leg from Shiller's CPI-
 * deflated column; the bond leg deflated here via `bondRealReturn`), so the
 * result is used directly by the real-dollar engine and CPI is NOT re-applied
 * downstream.
 */
export function blendedRealReturn(year: number, stockPct: number): number {
  const row = loadShillerAnnual().find((r) => r.year === year);
  if (!row) throw new Error(`No Shiller data for year ${year}`);
  return stockPct * row.sp500RealReturn + (1 - stockPct) * bondRealReturn(row);
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
