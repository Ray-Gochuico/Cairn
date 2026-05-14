export interface TaxYearResult {
  year: number | null;
  isCurrent: boolean;
}

/**
 * Pure function. Resolves the tax year to use for calculator math.
 * @param calendarYear - result of new Date().getFullYear()
 * @param seededYears  - distinct years present in the tax_rules table (ascending preferred)
 */
export function resolveTaxYear(calendarYear: number, seededYears: number[]): TaxYearResult {
  if (seededYears.length === 0) return { year: null, isCurrent: false };
  if (seededYears.includes(calendarYear)) return { year: calendarYear, isCurrent: true };
  const mostRecent = Math.max(...seededYears);
  return { year: mostRecent, isCurrent: false };
}

/** Convenience wrapper for use in components/stores. Reads years from the tax-rules store cache. */
export function getCurrentTaxYear(seededYears: number[]): TaxYearResult {
  return resolveTaxYear(new Date().getFullYear(), seededYears);
}
