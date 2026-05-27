// 2026 IRS / SSA contribution limits. Sources (verified 2026-05-27):
//   - 401(k) employee deferral: IRS Notice (Oct 2025) — $24,500.
//   - HSA self-only / family: IRS Rev. Proc. 2025-19 — $4,400 / $8,750.
//   - DCFSA: One Big Beautiful Bill Act (OBBBA, 2025) raised the cap to
//     $7,500 / $3,750 (MFS) effective 2026-01-01. The pre-OBBBA limit had
//     been $5,000 / $2,500 since 1986. https://natlawreview.com/article/
//     dependent-care-assistance-program-limit-increase-2026
//   - SS wage base ("contribution and benefit base"): SSA Oct 2025
//     announcement — $184,500 (up from $176,100 in 2025). Mirrored at
//     https://tax.thomsonreuters.com/news/ssa-announces-social-security-taxable-wage-base-for-2026/
export const CONTRIBUTION_LIMITS_2026 = {
  EMPLOYEE_401K: 24500,
  HSA_SELF_ONLY: 4400,
  HSA_FAMILY: 8750,
  DCFSA_MFJ_SINGLE_HOH: 7500,
  DCFSA_MFS: 3750,
  SOCIAL_SECURITY_WAGE_BASE: 184500,
} as const;

export function hsaLimitForHousehold(opts: { personCount: number; dependentCount: number }): number {
  if (opts.personCount > 1 || opts.dependentCount > 0) {
    return CONTRIBUTION_LIMITS_2026.HSA_FAMILY;
  }
  return CONTRIBUTION_LIMITS_2026.HSA_SELF_ONLY;
}

export function dcfsaLimit(filingStatus: 'SINGLE' | 'MFJ' | 'MFS' | 'HOH'): number {
  return filingStatus === 'MFS'
    ? CONTRIBUTION_LIMITS_2026.DCFSA_MFS
    : CONTRIBUTION_LIMITS_2026.DCFSA_MFJ_SINGLE_HOH;
}
