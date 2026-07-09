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
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';

export const TAX_YEAR_2026 = {
  /** Annual contribution cap, all IRAs combined. 2026 per Notice 2025-67. */
  iraContributionLimit: 7500,
  /** Additional contribution permitted for filers 50+ on top of the cap. 2026. */
  iraCatchUpAge50Plus: 1100,

  /** §402(g) elective deferral — references the app-wide constant so the
   * paycheck engine and the roadmap can never disagree. $24,500 for 2026. */
  electiveDeferralLimit: CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K,
  /** §415(c) combined DC limit (employee + employer + after-tax), 2026.
   * Notice 2025-67. Roadmap mega-backdoor node is the only consumer. */
  dcCombinedLimit: 72_000,

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
