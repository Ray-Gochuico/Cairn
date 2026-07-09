/**
 * "The Ledger" briefing — Wave 13 / design Direction 1 (spec:
 * docs/superpowers/plans/2026-07-09-design-directions-spec.md).
 *
 * Everything here is PURE and deterministic: the Dashboard injects today's
 * date, the stored visit stamps, and the already-derived signals; this module
 * owns the ranking, the materiality floors, and the vetted copy templates.
 * Calm-ethos guardrails are CODE, not convention: positive/steady framing
 * leads, a market dip is tone 'neutral' (never a red 'negative'), nothing
 * below the floors makes a row, and the concentration note keeps the spec's
 * "Note — not a warning." wording verbatim.
 */

// ---------------------------------------------------------------------------
// Visit stamps (persisted as app_settings.last_visit_date /
// .briefing_baseline_date — migration 0050)
// ---------------------------------------------------------------------------

export interface VisitStamps {
  lastVisitDate: string | null;
  briefingBaselineDate: string | null;
}

export type BriefingMode = 'last-visit' | 'last-month';

export interface VisitRoll {
  /** What app_settings should hold after this open. */
  stamps: VisitStamps;
  /** True on the first open of a new day — the caller persists exactly then. */
  changed: boolean;
  /** The day the briefing measures from, or null → use endOfLastMonthIso. */
  baselineIso: string | null;
  mode: BriefingMode;
}

/**
 * Roll the visit stamps for an app open on `todayIso` (local calendar day).
 * First open of a new day: baseline ← previous visit day, stamp ← today.
 * Same-day re-open: nothing moves, so the baseline is stable all day.
 * A baseline that isn't strictly in the past (first-ever open, day 2 of app
 * life before any baseline exists, or a backwards clock) falls back to
 * 'last-month' — the briefing must never measure today against today/future.
 */
export function rollVisitStamps(stored: VisitStamps, todayIso: string): VisitRoll {
  const isNewDay = stored.lastVisitDate === null || stored.lastVisitDate < todayIso;
  // Skew guard: a stored baseline at/after today was written by a future
  // clock (or the file is corrupt). Distrust the whole stamp pair for today's
  // briefing — never measure today against today/the future — and null the
  // persisted baseline so every re-open today lands on the same fallback.
  const skewed =
    stored.briefingBaselineDate !== null && stored.briefingBaselineDate >= todayIso;
  const baseline = skewed
    ? null
    : isNewDay
      ? stored.lastVisitDate
      : stored.briefingBaselineDate;
  const stamps: VisitStamps = isNewDay
    ? { lastVisitDate: todayIso, briefingBaselineDate: baseline }
    : skewed
      ? { lastVisitDate: stored.lastVisitDate, briefingBaselineDate: null }
      : stored;
  const changed = isNewDay || skewed;
  if (baseline === null || baseline >= todayIso) {
    return { stamps, changed, baselineIso: null, mode: 'last-month' };
  }
  return { stamps, changed, baselineIso: baseline, mode: 'last-visit' };
}

/**
 * Last CALENDAR day of the month before `today` — the fallback baseline.
 * Month-close is where snapshot history reliably exists (the Monthly ritual
 * confirms balances at the last business day of the month, which is always
 * on-or-before this date), unlike a rolling minus-one-month date which can
 * land in a history gap. Local getters, matching lastMonthYyyymm's style.
 */
export function endOfLastMonthIso(today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), 0); // day 0 = prev month's last day
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTH_NAME_FMT = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });

/** "2026-06" → "June". */
export function monthName(yyyymm: string): string {
  return MONTH_NAME_FMT.format(new Date(`${yyyymm}-01T00:00:00Z`));
}

/** Card heading: the spec's hero title, or the honest month fallback. */
export function briefingHeading(mode: BriefingMode, lastMonthYyyymm: string): string {
  return mode === 'last-visit' ? 'Since your last visit' : `Since ${monthName(lastMonthYyyymm)}`;
}
