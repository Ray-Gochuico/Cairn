export type Granularity = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

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

function bucketEndFor(dateIso: string, g: Granularity): string {
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
