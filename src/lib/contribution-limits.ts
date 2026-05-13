export const CONTRIBUTION_LIMITS_2026 = {
  EMPLOYEE_401K: 24500,
  HSA_SELF_ONLY: 4400,
  HSA_FAMILY: 8750,
  DCFSA_MFJ_SINGLE_HOH: 5000,
  DCFSA_MFS: 2500,
  SOCIAL_SECURITY_WAGE_BASE: 176100,
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
