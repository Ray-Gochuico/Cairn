/**
 * Bundled college-cost reference data (guided interview Wave T3, D-GI3 ADOPTED).
 *
 * Sources (verified 2026-08-25 by the implementing agent):
 *   - College Board, "Trends in College Pricing and Student Aid 2025"
 *     (Ma, Pender, Hu; New York: College Board; published November 2025,
 *     tables prepared October 2025) — retrieved from
 *     research.collegeboard.org/trends/college-pricing:
 *       - Table CP-1 (official Excel data workbook,
 *         Trends-in_College-Pricing-2025-excel-data.xlsx): published
 *         (sticker) tuition+fees and housing+food per sector, 2025-26
 *         academic year.
 *       - Figure CP-4 (same workbook): ten-year percentage change in
 *         published tuition and fees in CONSTANT 2025 DOLLARS, 2015-16 to
 *         2025-26, per sector — the report's inflation-adjusted decade
 *         growth. Stored here annualized: ((1+total)^(1/10) − 1) × 100.
 *       - Figure CP-6 (same workbook): 2025-26 in-state tuition+fees by
 *         state, public four-year sector (50 states; the US aggregate row
 *         is excluded — it duplicates TUITION_STICKER).
 *   - Cross-checked against the College Board newsroom release
 *     ("Trends in College Pricing and Student Aid Report", 2025-11-06),
 *     the report's Highlights (research.collegeboard.org/trends/
 *     college-pricing/highlights and the Highlights PDF, MAR-23013,
 *     November 2025), Community College Daily coverage (2025-11, two-year
 *     figures incl. the $10,850 housing+food), and FinanceWonk's
 *     transcription of the same tables (four-year housing+food figures).
 *
 * EVERY growth rate in this module is REAL (inflation-adjusted, constant
 * dollars) — the type contract (`basis: 'real'`) is load-bearing: the
 * tradeoff card computes in today's dollars, and this repo has shipped the
 * nominal-on-real blend bug three times. A nominal rate must never be
 * stored here. The out-of-state sector has NO over-time series in the 2025
 * edition (Figure CP-4 covers three sectors) and ships `null` — never a
 * proxy rate, never an invented one.
 *
 * Reference data for in-app planning hints only (the 529-state-deductions.ts
 * / contribution-limits.ts discipline). Sticker prices, not post-aid cost.
 * Bundled at build; the app makes no network calls for this data.
 *
 * Re-vintage procedure: bump TUITION_BASE_ACADEMIC_YEAR and the
 * DISCLOSURES.interview version together — the disclosure body hard-codes
 * the base year and a consistency test enforces agreement.
 */

export const TUITION_BASE_ACADEMIC_YEAR = '2025-26';

export const TUITION_SECTORS = [
  'PUBLIC_4YR_IN_STATE',
  'PUBLIC_4YR_OUT_OF_STATE',
  'PRIVATE_NONPROFIT_4YR',
  'PUBLIC_2YR_IN_DISTRICT',
] as const;
export type TuitionSector = (typeof TUITION_SECTORS)[number];

export interface TuitionSticker {
  /** Published tuition + required fees, $/yr, TUITION_BASE_ACADEMIC_YEAR dollars. */
  tuitionFees: number;
  /** On-campus housing + food, $/yr; null where the source publishes none. */
  housingFood: number | null;
}

/** Table CP-1, 2025-26 (enrollment-weighted sticker prices, as published). */
export const TUITION_STICKER: Readonly<Record<TuitionSector, TuitionSticker>> = {
  PUBLIC_4YR_IN_STATE: { tuitionFees: 11_950, housingFood: 13_900 },
  PUBLIC_4YR_OUT_OF_STATE: { tuitionFees: 31_880, housingFood: 13_900 },
  PRIVATE_NONPROFIT_4YR: { tuitionFees: 45_000, housingFood: 15_920 },
  // Table CP-1 publishes a two-year housing+food figure ($10,850) — recorded
  // as published, not nulled as a "commuter sector" assumption.
  PUBLIC_2YR_IN_DISTRICT: { tuitionFees: 4_150, housingFood: 10_850 },
};

export interface TuitionRealGrowth {
  /** % per year ABOVE inflation (REAL, constant dollars), over windowYears ending at the base year. */
  pctPerYear: number;
  basis: 'real';
  windowYears: 10;
}

/**
 * Annualized from Figure CP-4's published constant-dollar decade totals,
 * 2015-16 → 2025-26 (exact workbook decimals in the per-line comments);
 * pctPerYear = ((1 + total)^(1/10) − 1) × 100, rounded to 4 decimals.
 * `null` = the sector has no published over-time series in this edition.
 */
export const TUITION_REAL_GROWTH = {
  // Figure CP-4: −6.713505074160808% total over the decade (published
  // rounding: "declined by 7%", report Highlights p.3).
  PUBLIC_4YR_IN_STATE: { pctPerYear: -0.6925, basis: 'real', windowYears: 10 },
  // Figure CP-4 has no out-of-state column and the 2025 edition publishes
  // no out-of-state over-time series anywhere (Tables CP-2/CP-3/CP-4/CP-5
  // are in-state/in-district; Table CP-6 covers flagships only).
  PUBLIC_4YR_OUT_OF_STATE: null,
  // Figure CP-4: +2.4356931481902988% total over the decade (published
  // rounding: "increased by 2%", report Highlights p.3).
  PRIVATE_NONPROFIT_4YR: { pctPerYear: 0.2409, basis: 'real', windowYears: 10 },
  // Figure CP-4: −10.173160173160178% total over the decade (published
  // rounding: "declined by 10%", report Highlights p.3).
  PUBLIC_2YR_IN_DISTRICT: { pctPerYear: -1.0671, basis: 'real', windowYears: 10 },
} as const satisfies Readonly<Record<TuitionSector, TuitionRealGrowth | null>>;

export const TUITION_SECTOR_LABELS: Readonly<Record<TuitionSector, string>> = {
  PUBLIC_4YR_IN_STATE: 'public four-year in-state',
  PUBLIC_4YR_OUT_OF_STATE: 'public four-year out-of-state',
  PRIVATE_NONPROFIT_4YR: 'private nonprofit four-year',
  PUBLIC_2YR_IN_DISTRICT: 'public two-year in-district',
};

/**
 * 2025-26 published in-state tuition+fees by state, public four-year sector
 * (Figure CP-6, enrollment-weighted, as published; 50 states, two-letter
 * USPS codes; DC is not published in the figure). EMPTY would mean a
 * national-only build (D-T3-10) — getTuition falls back and the CI-C18
 * degradation line stays suppressed; this build ships the full table.
 */
export const STATE_PUBLIC_4YR_TUITION_FEES: Readonly<Record<string, number>> = {
  AK: 9_680, AL: 12_540, AR: 10_500, AZ: 13_150, CA: 11_950,
  CO: 13_710, CT: 17_360, DE: 16_470, FL: 6_360, GA: 8_540,
  HI: 11_460, IA: 11_180, ID: 9_170, IL: 15_680, IN: 10_650,
  KS: 10_580, KY: 12_460, LA: 10_730, MA: 15_900, MD: 11_480,
  ME: 12_790, MI: 16_700, MN: 14_730, MO: 13_090, MS: 10_110,
  MT: 8_780, NC: 7_540, ND: 11_080, NE: 9_980, NH: 18_000,
  NJ: 17_960, NM: 9_270, NV: 9_880, NY: 8_740, OH: 13_840,
  OK: 10_250, OR: 14_840, PA: 16_950, RI: 16_120, SC: 13_270,
  SD: 9_390, TN: 11_740, TX: 11_260, UT: 8_170, VA: 16_090,
  VT: 18_090, WA: 12_260, WI: 10_600, WV: 10_000, WY: 7_430,
};

export interface TuitionLookup {
  tuitionFees: number;
  /** 0 where the sector publishes no housing/food figure. */
  housingFood: number;
  stateSpecific: boolean;
}

export function getTuition(sector: TuitionSector, state: string): TuitionLookup {
  const base = TUITION_STICKER[sector];
  const stateRow =
    sector === 'PUBLIC_4YR_IN_STATE' ? STATE_PUBLIC_4YR_TUITION_FEES[state] : undefined;
  return {
    tuitionFees: stateRow ?? base.tuitionFees,
    housingFood: base.housingFood ?? 0,
    stateSpecific: stateRow !== undefined,
  };
}
