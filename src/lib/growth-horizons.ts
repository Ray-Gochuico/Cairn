/**
 * Pure logic backing the portfolio "growth card" (see
 * src/components/charts/GrowthCard.tsx). The card shows how a single value
 * (investments value, or net worth) has changed versus a baseline measured
 * one of five horizons ago: yesterday, a week, a month, a quarter, a year.
 *
 * Everything here is deterministic and side-effect free so it can be unit
 * tested without a DB or React — the caller injects both the "now" instant
 * and a `valueAsOf(dateIso)` lookup. Keeping the math here (rather than in
 * the component) is the whole point: the component stays presentational.
 */

export interface HorizonDef {
  key: '1d' | '1w' | '1m' | '1q' | '1y';
  label: string;
  /** ISO YYYY-MM-DD for the baseline date this horizon measures against. */
  baselineDate: (now: Date) => string;
}

/** Slice a Date to its UTC calendar day as YYYY-MM-DD. */
function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Horizon baseline-date helpers. All math is done in UTC so the resulting
 * calendar day never drifts with the running machine's timezone — a late
 * evening local instant won't slip the "yesterday" date back two days.
 * Day-based horizons (1d, 1w) subtract whole days; calendar horizons
 * (1m, 1q, 1y) step the UTC month/year and let Date normalize overflow.
 */
function minusDays(now: Date, days: number): string {
  return toIsoDay(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}

function minusMonths(now: Date, months: number): string {
  // Anchor on the UTC Y/M/D so we don't reintroduce TZ drift via local
  // getters. setUTCMonth handles negative/overflow month indices.
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  d.setUTCMonth(d.getUTCMonth() - months);
  return toIsoDay(d);
}

export const GROWTH_HORIZONS: HorizonDef[] = [
  { key: '1d', label: 'Since yesterday', baselineDate: (now) => minusDays(now, 1) },
  { key: '1w', label: 'Past week', baselineDate: (now) => minusDays(now, 7) },
  { key: '1m', label: 'Past month', baselineDate: (now) => minusMonths(now, 1) },
  { key: '1q', label: 'Past quarter', baselineDate: (now) => minusMonths(now, 3) },
  { key: '1y', label: 'Past year', baselineDate: (now) => minusMonths(now, 12) },
];

export interface HorizonGrowth {
  key: string;
  label: string;
  baselineDate: string;
  current: number | null;
  baseline: number | null;
  /** current - baseline; null unless both are present. */
  deltaAbs: number | null;
  /** Fraction (0.1 = +10%); null if baseline is 0 or either value is null. */
  deltaPct: number | null;
  /** True only if both current and baseline are non-null. */
  available: boolean;
}

/**
 * Sum, per account, the latest snapshot whose snapshotDate <= dateIso, across
 * the given accountIds (or all accounts present in `snapshots` when
 * accountIds is undefined).
 *
 * Returns null when NO snapshot across the considered accounts falls
 * on-or-before dateIso — i.e. there is no history reaching that far back, so
 * the horizon should render "Not enough history yet" rather than a misleading
 * $0. (A real $0 baseline only arises when a snapshot exists with totalValue
 * 0, which sums to 0, not null.)
 *
 * Snapshot dates are ISO YYYY-MM-DD, so lexical string comparison is also
 * chronological — no Date parsing needed.
 */
export function sumLatestOnOrBefore(
  snapshots: ReadonlyArray<{ accountId: number; snapshotDate: string; totalValue: number }>,
  dateIso: string,
  accountIds?: ReadonlySet<number>,
): number | null {
  // Track the latest qualifying snapshot per account. We keep the date so a
  // later-but-still-eligible snapshot can replace an earlier one.
  const latestByAccount = new Map<number, { date: string; value: number }>();
  for (const s of snapshots) {
    if (accountIds && !accountIds.has(s.accountId)) continue;
    if (s.snapshotDate > dateIso) continue; // strictly after the cutoff
    const existing = latestByAccount.get(s.accountId);
    if (!existing || existing.date < s.snapshotDate) {
      latestByAccount.set(s.accountId, { date: s.snapshotDate, value: s.totalValue });
    }
  }
  if (latestByAccount.size === 0) return null;
  let sum = 0;
  for (const entry of latestByAccount.values()) sum += entry.value;
  return sum;
}

/**
 * Build the five HorizonGrowth rows. `valueAsOf` resolves a YYYY-MM-DD date to
 * the measured value at (or before) that date, or null when there's no history
 * that far back. `current` is `valueAsOf(today)`, where today is `now`'s UTC
 * calendar day; each `baseline` is `valueAsOf(horizon.baselineDate(now))`.
 *
 * available = current != null && baseline != null. deltaAbs/deltaPct are only
 * computed when available; deltaPct is null when baseline is 0 (division guard).
 */
export function computeHorizonGrowth(
  valueAsOf: (dateIso: string) => number | null,
  now: Date,
): HorizonGrowth[] {
  const todayIso = toIsoDay(now);
  const current = valueAsOf(todayIso);
  return GROWTH_HORIZONS.map((h) => {
    const baselineDate = h.baselineDate(now);
    const baseline = valueAsOf(baselineDate);
    const available = current != null && baseline != null;
    const deltaAbs = available ? current - baseline : null;
    // deltaPct is a fraction; guard against a zero baseline (the card shows
    // the absolute delta in that case and suppresses the percentage).
    const deltaPct =
      available && baseline !== 0 ? (current - baseline) / baseline : null;
    return {
      key: h.key,
      label: h.label,
      baselineDate,
      current,
      baseline,
      deltaAbs,
      deltaPct,
      available,
    };
  });
}
