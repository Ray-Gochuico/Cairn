/**
 * Compute current age in whole years from an ISO date-of-birth string.
 *
 * Subtracts the calendar-year delta and adjusts down by one when the birthday
 * hasn't yet occurred this year (compares month, then day-of-month).
 */
export function currentAge(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

/**
 * Age in whole years as-of the first day of `monthISO` (YYYY-MM). Used by the
 * What-If engine to detect a retirement transition month — the first month at
 * which a person's age meets or exceeds their target retirement age.
 * Returns 0 when `dob` is empty/null (treat as unborn-equivalent, i.e. no
 * retirement transition will ever fire).
 */
export function ageAtMonth(dob: string | null | undefined, monthISO: string): number {
  if (!dob) return 0;
  const birth = new Date(dob);
  const target = new Date(`${monthISO}-01T00:00:00Z`);
  let age = target.getUTCFullYear() - birth.getUTCFullYear();
  const m = target.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && target.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}
