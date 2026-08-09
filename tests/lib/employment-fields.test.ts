import { describe, it, expect } from 'vitest';
import {
  employmentDraftFromPerson, validateEmploymentDraft,
  employmentPatchFromDraft, normalizeEmploymentValues,
} from '@/lib/employment-fields';

describe('employment-fields (the ONE save contract)', () => {
  it('draftFromPerson stringifies required numerics so empties stay empty', () => {
    expect(employmentDraftFromPerson({
      employmentType: 'SALARY_NO_OT', annualSalaryPretax: 90000,
      hourlyRate: null, regularHoursPerWeek: 40, otThresholdHoursPerWeek: null,
    })).toEqual({
      employmentType: 'SALARY_NO_OT', annualSalaryPretax: '90000',
      hourlyRate: null, regularHoursPerWeek: '40', otThresholdHoursPerWeek: null,
    });
  });

  it('validation: SALARY_* requires salary; non-SALARY_NO_OT requires rate + hours', () => {
    expect(validateEmploymentDraft({
      employmentType: 'SALARY_NO_OT', annualSalaryPretax: '',
      hourlyRate: null, regularHoursPerWeek: '', otThresholdHoursPerWeek: null,
    })).toEqual({ ok: false, salaryMissing: true, hourlyMissing: false });
    expect(validateEmploymentDraft({
      employmentType: 'HOURLY', annualSalaryPretax: '',
      hourlyRate: null, regularHoursPerWeek: '40', otThresholdHoursPerWeek: null,
    })).toEqual({ ok: false, salaryMissing: false, hourlyMissing: true });
    expect(validateEmploymentDraft({
      employmentType: 'SALARY_WITH_OT', annualSalaryPretax: '120000',
      hourlyRate: 55, regularHoursPerWeek: '40', otThresholdHoursPerWeek: 40,
    })).toEqual({ ok: true });
  });

  it('HOURLY persists salary 0 — including on a re-entry type change', () => {
    expect(employmentPatchFromDraft({
      employmentType: 'HOURLY', annualSalaryPretax: '55000', // stale from a salary past
      hourlyRate: 31.25, regularHoursPerWeek: '38', otThresholdHoursPerWeek: null,
    }, 40)).toEqual({
      employmentType: 'HOURLY', annualSalaryPretax: 0,
      hourlyRate: 31.25, regularHoursPerWeek: 38, otThresholdHoursPerWeek: null,
    });
  });

  it('SALARY_NO_OT with hidden/empty hours preserves the stored value, else 40', () => {
    const base = {
      employmentType: 'SALARY_NO_OT' as const, annualSalaryPretax: '90000',
      hourlyRate: null, regularHoursPerWeek: '', otThresholdHoursPerWeek: null,
    };
    expect(employmentPatchFromDraft(base, 37.5).regularHoursPerWeek).toBe(37.5);
    expect(employmentPatchFromDraft(base, null).regularHoursPerWeek).toBe(40);
  });

  it('normalizeEmploymentValues zeroes salary for HOURLY, passes others through', () => {
    expect(normalizeEmploymentValues({ employmentType: 'HOURLY', annualSalaryPretax: 55000 }))
      .toEqual({ employmentType: 'HOURLY', annualSalaryPretax: 0 });
    expect(normalizeEmploymentValues({ employmentType: 'SALARY_NO_OT', annualSalaryPretax: 90000 }))
      .toEqual({ employmentType: 'SALARY_NO_OT', annualSalaryPretax: 90000 });
  });
});
