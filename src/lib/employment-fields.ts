import type { EmploymentType, Person } from '@/types/schema';

/**
 * THE employment save contract (design 2a — extracted so PersonForm,
 * EmploymentSection, and the worded flow share one copy; the two shipped
 * copies disagreed: EmploymentSection zeroed salary on HOURLY, PersonForm
 * silently kept the stale hidden value).
 *   - SALARY_NO_OT | SALARY_WITH_OT require an annual salary.
 *   - HOURLY | SALARY_WITH_OT require hourlyRate + regular hours.
 *   - HOURLY persists annualSalaryPretax = 0 — ALWAYS (incl. re-entry type change).
 *   - SALARY_NO_OT hides the hours field; an empty draft preserves the stored
 *     schema-positive value (never writes a 0 that fails `.positive()`), else 40.
 */
export interface EmploymentDraft {
  employmentType: EmploymentType;
  /** Strings so an empty input stays empty instead of coercing to 0. */
  annualSalaryPretax: string;
  hourlyRate: number | null;
  regularHoursPerWeek: string;
  otThresholdHoursPerWeek: number | null;
}

export interface EmploymentPatch {
  employmentType: EmploymentType;
  annualSalaryPretax: number;
  hourlyRate: number | null;
  regularHoursPerWeek: number;
  otThresholdHoursPerWeek: number | null;
}

export type EmploymentPersonFields = Pick<
  Person,
  'employmentType' | 'annualSalaryPretax' | 'hourlyRate' | 'regularHoursPerWeek' | 'otThresholdHoursPerWeek'
>;

export function employmentDraftFromPerson(p: EmploymentPersonFields): EmploymentDraft {
  return {
    employmentType: p.employmentType,
    annualSalaryPretax: String(p.annualSalaryPretax),
    hourlyRate: p.hourlyRate,
    regularHoursPerWeek: String(p.regularHoursPerWeek),
    otThresholdHoursPerWeek: p.otThresholdHoursPerWeek,
  };
}

export type EmploymentValidation =
  | { ok: true }
  | { ok: false; salaryMissing: boolean; hourlyMissing: boolean };

export function validateEmploymentDraft(d: EmploymentDraft): EmploymentValidation {
  const isSalary = d.employmentType !== 'HOURLY';
  const needsHourlyFields = d.employmentType !== 'SALARY_NO_OT';
  const salaryMissing = isSalary && d.annualSalaryPretax.trim() === '';
  const hourlyMissing =
    needsHourlyFields && (d.hourlyRate == null || d.regularHoursPerWeek.trim() === '');
  if (salaryMissing || hourlyMissing) return { ok: false, salaryMissing, hourlyMissing };
  return { ok: true };
}

export function employmentPatchFromDraft(
  d: EmploymentDraft,
  storedRegularHoursPerWeek: number | null,
): EmploymentPatch {
  const isHourly = d.employmentType === 'HOURLY';
  return {
    employmentType: d.employmentType,
    annualSalaryPretax: isHourly ? 0 : Number(d.annualSalaryPretax),
    hourlyRate: d.hourlyRate,
    regularHoursPerWeek:
      d.regularHoursPerWeek.trim() === ''
        ? storedRegularHoursPerWeek ?? 40
        : Number(d.regularHoursPerWeek),
    otThresholdHoursPerWeek: d.otThresholdHoursPerWeek,
  };
}

/** RHF-boundary shim: zero the salary when the submitted type is HOURLY. */
export function normalizeEmploymentValues<
  T extends { employmentType: EmploymentType; annualSalaryPretax: number },
>(values: T): T {
  return values.employmentType === 'HOURLY' ? { ...values, annualSalaryPretax: 0 } : values;
}
