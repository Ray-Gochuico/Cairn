import { localTodayISO } from '@/lib/dates';

/** 'YYYY-MM' — the kernel's month key; `YEAR_MONTH_RE` in types/interview.ts is its schema twin. */
export type YearMonth = string;

/**
 * R4 (D-R4-10): the kernel's ONE calendar seam. Every calendar day in
 * src/domain/interview + src/lib/interview + src/components/interview derives
 * from the injected `ctx.today` — a LOCAL-midnight Date
 * (roadmap/context.ts: dateFromLocalISO(useLocalToday())) — through these
 * helpers. Never the UTC day of that Date (the prior day, and on the local
 * 1st the prior MONTH, in every UTC+ zone), and never a Date for month
 * arithmetic (setUTCMonth/setMonth overflow the day-of-month on the 29th–31st
 * in EVERY zone: Jan 31 + 1 → Mar 3 → "March").
 */
export function todayIsoOf(ctx: { today: Date }): string {
  return localTodayISO(ctx.today);
}

/** 'YYYY-MM' + n months by STRING ARITHMETIC — no Date, so no day can overflow. */
export function addMonthsYm(ym: YearMonth, n: number): YearMonth {
  const y = Number(ym.slice(0, 4));
  const m0 = Number(ym.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m0 / 12);
  const mm = ((m0 % 12) + 12) % 12 + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

/** 'Month YYYY' for a 'YYYY-MM' — the shipped T12:00Z + timeZone:'UTC' idiom
 *  (home-purchase.ts / college-vs-retirement.ts), consolidated; output byte-identical. */
export function monthYearLabel(ym: YearMonth): string {
  return new Date(`${ym}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The LOCAL calendar day of an ISO INSTANT (answered_at). An evening answer
 *  west of UTC is already the next UTC day, so the instant's UTC day is the
 *  wrong month on the last local day of a month (U1 staleness, U10 label). */
export function localDayOfInstant(iso: string): string {
  return localTodayISO(new Date(iso));
}

/** The ONE bridge out of the local-day world into engines that read UTC
 *  accessors (computeGoalProgress, currentAgeAsOf): a calendar day at UTC noon
 *  reads as that day under every zone offset. B3 exports this bridge from
 *  @/lib/dates (currentAge's local-day fix) — re-exported here, never a second copy. */
export { utcNoonOf } from '@/lib/dates';
