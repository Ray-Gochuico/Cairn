export type Granularity = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export type TimeWindow = '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'ALL';

/**
 * Returns the ISO (YYYY-MM-DD) cutoff date for a time window relative to `today`,
 * or `null` for `'ALL'` (no filtering). `'YTD'` is Jan 1 of today's UTC year.
 * Uses UTC math so the result is timezone-stable regardless of the caller's locale.
 */
export function cutoffForWindow(w: TimeWindow, today: Date = new Date()): string | null {
  if (w === 'ALL') return null;
  if (w === 'YTD') return `${today.getUTCFullYear()}-01-01`;
  const monthsBack = w === '3M' ? 3 : w === '6M' ? 6 : w === '1Y' ? 12 : 60;
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
}

export interface BucketedSeries {
  /** ISO end-of-period dates, sorted ascending. */
  bucketEnds: string[];
  /** Per-account value at each bucket end (parallel to bucketEnds). */
  valuesByAccount: Map<number, number[]>;
}

interface Snap {
  accountId: number;
  snapshotDate: string;
  totalValue: number;
}

/**
 * Absolute day-distance between two ISO (YYYY-MM-DD) dates. UTC math so
 * the result is timezone-stable. Exported so sibling helpers
 * (`asset-snapshot-bucketing.ts`) can share the same tiebreaker math
 * instead of duplicating it.
 */
export function absDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(Math.round((da - db) / 86_400_000));
}

/** Exported for chart libs that need bucket-end math. */
export function bucketEndFor(dateIso: string, g: Granularity): string {
  const d = new Date(dateIso + 'T00:00:00Z');
  if (g === 'DAY') return dateIso;
  if (g === 'WEEK') {
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (6 - day)); // Saturday
    return d.toISOString().slice(0, 10);
  }
  if (g === 'MONTH') {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return end.toISOString().slice(0, 10);
  }
  if (g === 'QUARTER') {
    const q = Math.floor(d.getUTCMonth() / 3);
    const end = new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0));
    return end.toISOString().slice(0, 10);
  }
  // YEAR
  return `${d.getUTCFullYear()}-12-31`;
}

export function bucketSnapshots(
  snapshots: Snap[],
  granularity: Granularity,
  maxBuckets: number,
): BucketedSeries {
  if (snapshots.length === 0) return { bucketEnds: [], valuesByAccount: new Map() };

  // Group: bucketEnd -> accountId -> latest snapshot in that bucket
  const grouped = new Map<string, Map<number, Snap>>();
  for (const s of snapshots) {
    const bEnd = bucketEndFor(s.snapshotDate, granularity);
    let inner = grouped.get(bEnd);
    if (!inner) {
      inner = new Map();
      grouped.set(bEnd, inner);
    }
    const prev = inner.get(s.accountId);
    if (!prev || s.snapshotDate > prev.snapshotDate) {
      inner.set(s.accountId, s);
    }
  }

  // Sort bucket ends ascending, cap to most recent N
  const allBucketEnds = [...grouped.keys()].sort();
  const bucketEnds = allBucketEnds.slice(-maxBuckets);

  // Collect all account ids that ever appear
  const allAccounts = new Set<number>();
  for (const inner of grouped.values()) {
    for (const id of inner.keys()) allAccounts.add(id);
  }

  // Build values-per-account with carry-forward across buckets
  const valuesByAccount = new Map<number, number[]>();
  for (const accountId of allAccounts) {
    const values: number[] = [];
    let lastKnown: number | null = null;
    for (const bEnd of bucketEnds) {
      const snap = grouped.get(bEnd)?.get(accountId);
      if (snap) {
        lastKnown = snap.totalValue;
        values.push(lastKnown);
      } else if (lastKnown !== null) {
        values.push(lastKnown);
      } else {
        values.push(0);
      }
    }
    valuesByAccount.set(accountId, values);
  }

  return { bucketEnds, valuesByAccount };
}

/**
 * Step from one bucket end to the start of the next bucket (i.e. one day
 * after `currentEnd`). Used to enumerate consecutive bucket ends without
 * relying on the input snapshot dates landing inside every bucket.
 */
function nextBucketStart(currentEnd: string, _g: Granularity): string {
  const d = new Date(`${currentEnd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Same return shape as `bucketSnapshots`, but each (account, bucket) cell
 * holds the value of the snapshot whose snapshotDate is CLOSEST to the
 * bucket end, NOT the latest one at-or-before the bucket end. A snapshot
 * dated AFTER a bucket end can still claim that bucket if it's the closest
 * available data point. A single sparse snapshot can anchor many
 * consecutive buckets (the chart shows a flat horizontal between them,
 * which is the natural "best guess" rendering).
 *
 * Tiebreaker for equidistant snapshots: the LATER snapshotDate wins
 * (deterministic; matches the "later overwrites earlier" pattern used
 * elsewhere in this codebase).
 *
 * Used by chart code that wants intuitive sparse-data rendering. Other
 * consumers should keep using `bucketSnapshots`.
 */
export function bucketSnapshotsByClosestDate(
  snapshots: Snap[],
  granularity: Granularity,
  maxBuckets: number,
): BucketedSeries {
  if (snapshots.length === 0) {
    return { bucketEnds: [], valuesByAccount: new Map() };
  }

  // Bucket-end list: enumerate from the earliest snapshot's bucket end up
  // through the latest snapshot's bucket end, then cap to maxBuckets (the
  // most-recent window). Mirrors bucketSnapshots' "buckets are derived
  // from input dates" semantic, but walks contiguous buckets so a single
  // sparse snapshot still produces multiple bucket cells.
  const sortedDates = snapshots
    .map((s) => s.snapshotDate)
    .sort((a, b) => a.localeCompare(b));
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];

  const ends: string[] = [];
  let cursor = bucketEndFor(minDate, granularity);
  const upperBound = bucketEndFor(maxDate, granularity);
  while (cursor <= upperBound) {
    ends.push(cursor);
    cursor = bucketEndFor(nextBucketStart(cursor, granularity), granularity);
  }
  const bucketEnds = ends.slice(Math.max(0, ends.length - maxBuckets));

  // Group snapshots by account so we don't re-scan the whole list for
  // every (account, bucket) cell.
  const byAccount = new Map<number, Snap[]>();
  for (const s of snapshots) {
    const arr = byAccount.get(s.accountId);
    if (arr) arr.push(s);
    else byAccount.set(s.accountId, [s]);
  }

  const valuesByAccount = new Map<number, number[]>();
  for (const [accountId, snaps] of byAccount) {
    const series: number[] = [];
    for (const end of bucketEnds) {
      let bestValue = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      let bestDate = '';
      for (const s of snaps) {
        const d = absDays(s.snapshotDate, end);
        // Strict <: equal distances fall through; the later snapshot
        // wins via the dedicated tiebreaker on the next line.
        if (
          d < bestDistance ||
          (d === bestDistance && s.snapshotDate > bestDate)
        ) {
          bestDistance = d;
          bestValue = s.totalValue;
          bestDate = s.snapshotDate;
        }
      }
      series.push(bestValue);
    }
    valuesByAccount.set(accountId, series);
  }

  return { bucketEnds, valuesByAccount };
}
