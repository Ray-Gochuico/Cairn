/**
 * Age in whole years for an ISO date-of-birth string as-of an explicit
 * instant `today`. Pure over both args (no clock read) so callers that need
 * a deterministic or injected "now" (the onboarding tailoring engine, tests)
 * can pass it directly.
 *
 * Parses the DOB as UTC midnight (`T00:00:00Z`) and compares against `today`
 * using UTC accessors — matching `currentAge`/`ageAtMonth` so a Jan-1 DOB
 * never shifts into Dec-31 of the prior year in a UTC-negative timezone and
 * reads one year too high. Subtracts the calendar-year delta, then adjusts
 * down by one when the birthday hasn't yet occurred as-of `today`
 * (month first, then day-of-month).
 */
export function currentAgeAsOf(dob: string, today: Date): number {
  const birth = new Date(`${dob}T00:00:00Z`);
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const m = today.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

/**
 * The UTC-noon instant of a LOCAL calendar day ('YYYY-MM-DD') — the ONE bridge
 * from a local day into helpers that read UTC accessors (`currentAgeAsOf`).
 * Noon, so no zone offset (±14 h) can move the instant off the day (B3).
 */
export function utcNoonOf(isoDay: string): Date {
  return new Date(`${isoDay}T12:00:00Z`);
}

/**
 * Age in whole years as of the LOCAL calendar day (B3, v1.7.0 — R4 design
 * review ruling 7). Derives the local day (`localTodayISO`) and bridges it at
 * UTC noon into `currentAgeAsOf`, so the DOB side (UTC midnight) and the as-of
 * side (UTC noon) compare on one calendar with no T6 regression. The previous
 * shape passed the wall-clock instant straight through, i.e. read the UTC day
 * — the neighbouring day between local midnight and UTC midnight — so a
 * birthday ticked a day late east of Greenwich (the local morning is still the
 * previous UTC day) and a day early west of it (the local evening is already
 * the next UTC day), and the calculators' age could disagree with the
 * interview kernel's local-day age. `now` is injectable for tests; production
 * callers omit it.
 */
export function currentAge(dob: string, now: Date = new Date()): number {
  return currentAgeAsOf(dob, utcNoonOf(localTodayISO(now)));
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

/** Local calendar day as YYYY-MM-DD (NOT toISOString, which is UTC). The
 * canonical home (Wave 11 T8); trivia/daily.ts re-exports it. */
export function localTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a local calendar day back to a Date at LOCAL midnight — the inverse
 * of localTodayISO. Use when a page needs a Date for local accessors
 * (getFullYear/getMonth) derived from useLocalToday()'s string. */
export function dateFromLocalISO(isoDay: string): Date {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d);
}
