import type { AssetValueSnapshot } from '@/types/schema';
import type { AssetSnapshotOwnerType } from '@/types/enums';
import { absDays, type Granularity } from '@/lib/snapshot-bucketing';

/**
 * Resolve a per-entity value at each bucket end. The chart's data builder
 * calls this once per property/vehicle slot to get one number per visible
 * bucket on the X axis.
 *
 * Semantics (closest-to-bucket-end, parallel to `bucketSnapshotsByClosestDate`
 * for accounts, but for a single owner):
 *  - Filter `snapshots` down to those matching (ownerType, ownerId).
 *  - For each bucketEnd, pick the snapshot whose snapshotDate is CLOSEST
 *    (smallest absolute day-distance) to bucketEnd. A snapshot dated AFTER
 *    a bucketEnd can still claim that bucket if it's the closest data
 *    point. A single sparse snapshot anchors every bucket — the resulting
 *    flat horizontal is the natural "best guess" rendering.
 *  - Tiebreaker for equidistant snapshots: the LATER snapshotDate wins
 *    (matches the "later overwrites earlier" pattern used elsewhere in
 *    this codebase, and `bucketSnapshotsByClosestDate`).
 *  - If NO snapshot exists for this entity at all, fall back to
 *    `fallbackValue` (the entity's `currentEstimatedValue` typically).
 *  - If both fallback is null and no snapshot is available, the bucket
 *    is 0 — the segment effectively hides from the stack.
 *
 * `granularity` is currently unused — bucket ends are already enumerated
 * by the caller — but kept in the signature so a future implementation
 * that interpolates intra-bucket dates has a hook.
 */
export function bucketAssetSnapshots(
  snapshots: AssetValueSnapshot[],
  ownerType: AssetSnapshotOwnerType,
  ownerId: number,
  bucketEnds: string[],
  _granularity: Granularity,
  fallbackValue: number | null,
): number[] {
  const owned = snapshots.filter(
    (s) => s.ownerType === ownerType && s.ownerId === ownerId,
  );

  if (owned.length === 0) {
    return bucketEnds.map(() => fallbackValue ?? 0);
  }

  return bucketEnds.map((end) => {
    let bestValue: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestDate = '';
    for (const s of owned) {
      const d = absDays(s.snapshotDate, end);
      // Strict <: ties fall through to the dedicated later-wins
      // tiebreaker on the next line.
      if (
        d < bestDistance ||
        (d === bestDistance && s.snapshotDate > bestDate)
      ) {
        bestDistance = d;
        bestValue = s.value;
        bestDate = s.snapshotDate;
      }
    }
    return bestValue ?? (fallbackValue ?? 0);
  });
}

export interface AssetAnchor {
  purchaseDate: string | null;
  purchasePrice: number | null;
  currentEstimatedValue: number | null;
}

/**
 * As-of valuation for a single property/vehicle: for each bucketEnd
 * (ascending), the latest snapshot with snapshotDate ≤ bucketEnd.
 * Before the first snapshot: 0 before `purchaseDate` (when known),
 * `purchasePrice` (when known) from purchase until the first snapshot,
 * else 0. Entities with NO snapshots at all fall back to a flat
 * `currentEstimatedValue` (zeroed before `purchaseDate` when known) —
 * the "est."-badged approximation.
 *
 * Same-date duplicates: the snapshot with the higher `id` (later insert)
 * wins, matching the module's "later overwrites earlier" convention.
 *
 * Replaces the closest-date semantics of `bucketAssetSnapshots` for the
 * asset value chart: no look-ahead, so range deltas measure what actually
 * happened inside the range. PRECONDITION: bucketEnds ascending.
 */
export function assetValuesAsOf(
  snapshots: AssetValueSnapshot[],
  ownerType: AssetSnapshotOwnerType,
  ownerId: number,
  bucketEnds: string[],
  anchor: AssetAnchor,
): number[] {
  const owned = snapshots
    .filter((s) => s.ownerType === ownerType && s.ownerId === ownerId)
    // Ascending id breaks same-date ties: the sweep consumes the highest
    // id LAST, so the later insert wins (a date-only stable sort would
    // preserve the store's id-DESC order and invert that).
    .sort(
      (a, b) =>
        a.snapshotDate.localeCompare(b.snapshotDate) ||
        (a.id ?? 0) - (b.id ?? 0),
    );

  if (owned.length === 0) {
    const est = anchor.currentEstimatedValue ?? 0;
    return bucketEnds.map((end) =>
      anchor.purchaseDate != null && end < anchor.purchaseDate ? 0 : est,
    );
  }

  const out: number[] = new Array(bucketEnds.length);
  let j = 0;
  let last: number | null = null;
  for (let i = 0; i < bucketEnds.length; i++) {
    const end = bucketEnds[i];
    while (j < owned.length && owned[j].snapshotDate <= end) {
      last = owned[j].value;
      j++;
    }
    if (last != null) {
      out[i] = last;
    } else if (anchor.purchaseDate != null && end >= anchor.purchaseDate && anchor.purchasePrice != null) {
      out[i] = anchor.purchasePrice;
    } else {
      out[i] = 0;
    }
  }
  return out;
}
