import type { AssetValueSnapshot } from '@/types/schema';
import type { AssetSnapshotOwnerType } from '@/types/enums';
import type { Granularity } from '@/lib/snapshot-bucketing';

/**
 * Resolve a per-entity value at each bucket end. The chart's data builder
 * calls this once per property/vehicle slot to get one number per visible
 * bucket on the X axis.
 *
 * Semantics (parallel to bucketSnapshots' carry-forward, but for a single
 * owner instead of all-accounts):
 *  - Filter `snapshots` down to those matching (ownerType, ownerId).
 *  - For each bucketEnd, pick the latest snapshot whose snapshotDate <=
 *    bucketEnd. That's the "value at the end of the period" — newer
 *    snapshots haven't happened yet in that bucket's slice of history.
 *  - For buckets before the earliest snapshot (or all buckets if no
 *    snapshots exist), fall back to `fallbackValue` (the entity's
 *    `currentEstimatedValue` typically). Spec § "Edge cases" — properties
 *    and vehicles with no asset_value_snapshot use the flat horizontal.
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
  const owned = snapshots
    .filter((s) => s.ownerType === ownerType && s.ownerId === ownerId)
    .slice()
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

  return bucketEnds.map((end) => {
    // Latest snapshot whose date <= end. The list is sorted ascending so
    // we scan until we pass `end`.
    let chosen: number | null = null;
    for (const s of owned) {
      if (s.snapshotDate <= end) {
        chosen = s.value;
      } else {
        break;
      }
    }
    if (chosen != null) return chosen;
    return fallbackValue ?? 0;
  });
}
