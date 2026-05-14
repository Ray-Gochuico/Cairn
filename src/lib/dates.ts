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
