/**
 * 2026 tax-year constants for the Roadmap rule engine.
 *
 * Numbers are IRS-published thresholds in effect for tax year 2026
 * (filings due Apr 2027). Update annually; bump TAX_YEAR_2026 → 2027
 * and review every consumer in src/domain/roadmap/rules/ when the IRS
 * releases new figures.
 *
 * All dollar amounts are nominal — phase-out ranges define the band
 * between "fully eligible" and "fully phased out", so a MAGI inside
 * the range means a *partial* benefit.
 */
export const TAX_YEAR_2026 = {
  /** Annual contribution cap, all IRAs combined. */
  iraContributionLimit: 7000,
  /** Additional contribution permitted for filers 50+ on top of the cap. */
  iraCatchUpAge50Plus: 1000,

  /**
   * Roth IRA direct-contribution income phase-out. Above the start
   * threshold the contribution caps shrink linearly; above the end
   * threshold the user cannot contribute directly (backdoor required).
   */
  roth: {
    singlePhaseOutStart: 153_000,
    singlePhaseOutEnd:   168_000,
    marriedPhaseOutStart: 242_000,
    marriedPhaseOutEnd:   252_000,
  },

  /**
   * Traditional-IRA deduction phase-out for filers who participate in
   * an employer retirement plan. Above the end threshold, the
   * contribution is allowed but not deductible.
   */
  traditionalIRADeduction: {
    singlePhaseOutStart: 81_000,
    singlePhaseOutEnd:   91_000,
    marriedPhaseOutStart: 129_000,
    marriedPhaseOutEnd:   149_000,
  },
} as const;
