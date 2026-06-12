import type { AssetValueSnapshot } from '@/types/schema';
import type { AssetSnapshotOwnerType } from '@/types/enums';

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
 * Replaces the closest-date semantics of the deleted `bucketAssetSnapshots`:
 * no look-ahead, so range deltas measure what actually happened inside the
 * range. PRECONDITION: bucketEnds ascending.
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
