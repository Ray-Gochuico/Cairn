import { describe, it, expect } from 'vitest';
import { TAX_YEAR_2026 } from '@/domain/roadmap/taxYear2026';
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';

describe('TAX_YEAR_2026 (Notice 2025-67 vintage check)', () => {
  it('carries the 2026 IRA limits', () => {
    expect(TAX_YEAR_2026.iraContributionLimit).toBe(7500);
    expect(TAX_YEAR_2026.iraCatchUpAge50Plus).toBe(1100);
  });
  it('elective deferral references the shared 401(k) constant (one source of truth)', () => {
    expect(TAX_YEAR_2026.electiveDeferralLimit).toBe(CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K); // 24_500
  });
  it('carries the 2026 §415(c) combined limit', () => {
    expect(TAX_YEAR_2026.dcCombinedLimit).toBe(72_000);
  });
});
