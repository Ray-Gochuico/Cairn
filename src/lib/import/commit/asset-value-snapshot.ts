// src/lib/import/commit/asset-value-snapshot.ts
import type { Database } from '@/db/db';
import type { AssetValueSnapshotsRepo } from '@/domain/asset-value-snapshots';
import type { CommitResult, PreviewRow } from '@/lib/import/types';
import type { AssetValueSnapshotResolved } from '@/lib/import/validators/asset-value-snapshot';

interface Deps {
  db: Database;
  assetValueSnapshots: AssetValueSnapshotsRepo;
}

/**
 * Commit a batch of validated `asset_value_snapshot` import rows. UPDATE
 * semantics overwrite the existing snapshot at the same (ownerType, ownerId,
 * snapshotDate) — same shape as account snapshots.
 */
export async function commitAssetValueSnapshotImport(
  rows: ReadonlyArray<PreviewRow<AssetValueSnapshotResolved>>,
  deps: Deps,
): Promise<CommitResult> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  if (rows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  await deps.db.execute('BEGIN');
  try {
    for (const row of rows) {
      if (row.status === 'error' || row.status === 'duplicate') {
        skipped += 1;
        continue;
      }
      if (row.status === 'update' && row.existingId != null) {
        await deps.assetValueSnapshots.update(row.existingId, row.resolved);
        updated += 1;
      } else if (row.status === 'new') {
        await deps.assetValueSnapshots.create(row.resolved);
        inserted += 1;
      } else {
        skipped += 1;
      }
    }
    await deps.db.execute('COMMIT');
  } catch (err) {
    await deps.db.execute('ROLLBACK');
    throw err;
  }

  return { inserted, updated, skipped };
}
