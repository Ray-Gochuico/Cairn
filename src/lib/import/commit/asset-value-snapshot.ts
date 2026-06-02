// src/lib/import/commit/asset-value-snapshot.ts
import type { BatchStatement, Database } from '@/db/db';
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

  // Collect every write as a Zod-validated {sql, params} statement, then run
  // them as ONE atomic batch on a single connection. The old BEGIN/body/COMMIT
  // expressed as separate `db.execute` calls wrapped NOTHING under prod's
  // plugin-sql connection POOL. UPDATE rows read-then-merge inside the repo
  // builder (the READ stays outside the atomic write set); only the resulting
  // write statement is batched. A failing row throws during collection, before
  // any write — preserving "fails on row N ⇒ 0 rows committed, error surfaced".
  const statements: BatchStatement[] = [];
  for (const row of rows) {
    if (row.status === 'error' || row.status === 'duplicate') {
      skipped += 1;
      continue;
    }
    if (row.status === 'update' && row.existingId != null) {
      statements.push(await deps.assetValueSnapshots.buildUpdateStatement(row.existingId, row.resolved));
      updated += 1;
    } else if (row.status === 'new') {
      statements.push(deps.assetValueSnapshots.buildCreateStatement(row.resolved));
      inserted += 1;
    } else {
      skipped += 1;
    }
  }

  await deps.db.executeBatch(statements, { transaction: true });

  return { inserted, updated, skipped };
}
