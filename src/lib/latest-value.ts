import type {
  AccountSnapshot,
  AssetValueSnapshot,
} from '@/types/schema';
import type { AssetSnapshotOwnerType } from '@/types/enums';

/**
 * Latest account snapshot value at or before `asOf` (YYYY-MM-DD). Returns
 * 0 if the account has no qualifying snapshot — the donut treats that as
 * "skip this slice" (per spec § "Edge cases").
 *
 * Mirrors the per-account semantics inside NetWorth.tsx's
 * `latestSnapshotsTotal` (which aggregates across accounts); breaking out
 * the single-account variant lets the AssetsDonut and (potentially) the
 * NetWorthTimeSeriesChart consume the same value resolution.
 */
export function latestSnapshotForAccount(
  accountId: number,
  snapshots: AccountSnapshot[],
  asOf: string,
): number {
  let chosen: AccountSnapshot | null = null;
  for (const s of snapshots) {
    if (s.accountId !== accountId) continue;
    if (s.snapshotDate > asOf) continue;
    if (!chosen || s.snapshotDate > chosen.snapshotDate) {
      chosen = s;
    }
  }
  return chosen?.totalValue ?? 0;
}

/**
 * Latest user-entered asset value snapshot for (ownerType, ownerId) at or
 * before `asOf`. Falls back to `fallbackValue` (typically the entity's
 * `currentEstimatedValue`) when no snapshot exists. Returns 0 when both
 * are absent — same skip semantics as latestSnapshotForAccount.
 */
export function latestAssetValue(
  snapshots: AssetValueSnapshot[],
  ownerType: AssetSnapshotOwnerType,
  ownerId: number,
  asOf: string,
  fallbackValue: number | null,
): number {
  let chosen: AssetValueSnapshot | null = null;
  for (const s of snapshots) {
    if (s.ownerType !== ownerType || s.ownerId !== ownerId) continue;
    if (s.snapshotDate > asOf) continue;
    if (!chosen || s.snapshotDate > chosen.snapshotDate) {
      chosen = s;
    }
  }
  if (chosen) return chosen.value;
  return fallbackValue ?? 0;
}
