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
