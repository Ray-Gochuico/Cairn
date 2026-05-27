import { describe, it, expect } from 'vitest';
import { CONTRIBUTION_LIMITS_2026, hsaLimitForHousehold, dcfsaLimit } from '@/lib/contribution-limits';

describe('CONTRIBUTION_LIMITS_2026', () => {
  it('matches IRS-published 2026 limits', () => {
    expect(CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K).toBe(24500);
    expect(CONTRIBUTION_LIMITS_2026.HSA_SELF_ONLY).toBe(4400);
    expect(CONTRIBUTION_LIMITS_2026.HSA_FAMILY).toBe(8750);
    expect(CONTRIBUTION_LIMITS_2026.DCFSA_MFJ_SINGLE_HOH).toBe(7500);
    expect(CONTRIBUTION_LIMITS_2026.DCFSA_MFS).toBe(3750);
    expect(CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE).toBe(184500);
  });
});

describe('hsaLimitForHousehold', () => {
  it('returns family limit when 2 persons are present', () => {
    expect(hsaLimitForHousehold({ personCount: 2, dependentCount: 0 })).toBe(8750);
  });
  it('returns family limit when dependents are present', () => {
    expect(hsaLimitForHousehold({ personCount: 1, dependentCount: 1 })).toBe(8750);
  });
  it('returns self-only limit for single adult, no dependents', () => {
    expect(hsaLimitForHousehold({ personCount: 1, dependentCount: 0 })).toBe(4400);
  });
});

describe('dcfsaLimit', () => {
  it('returns 3750 for MFS filing status (OBBBA 2026)', () => {
    expect(dcfsaLimit('MFS')).toBe(3750);
  });
  it('returns 7500 for SINGLE, MFJ, and HOH filing statuses (OBBBA 2026)', () => {
    expect(dcfsaLimit('SINGLE')).toBe(7500);
    expect(dcfsaLimit('MFJ')).toBe(7500);
    expect(dcfsaLimit('HOH')).toBe(7500);
  });
});
