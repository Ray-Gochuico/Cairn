// src/lib/import/commit.ts
import type { Database } from '@/db/db';
import type { AccountSnapshotsRepo } from '@/domain/snapshots';
import type { CommitResult, PreviewRow } from '@/lib/import/types';
import type { SnapshotResolved } from '@/lib/import/validators/snapshot-validator';

/**
 * Write a batch of validated snapshot rows in a single SQL transaction.
 * Throws (and rolls back) if any row fails.
 *
 * Callers must filter the input to status === 'new' | 'update' — error
 * and skipped rows should be excluded before calling.
 */
export async function commitSnapshotImport(
  rows: ReadonlyArray<PreviewRow<SnapshotResolved>>,
  deps: { db: Database; snapshots: AccountSnapshotsRepo },
): Promise<CommitResult> {
  let inserted = 0;
  let updated = 0;

  if (rows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  await deps.db.execute('BEGIN');
  try {
    for (const row of rows) {
      const { accountId, snapshotDate, totalValue, source } = row.resolved;
      if (accountId === undefined || snapshotDate === undefined || totalValue === undefined) {
        throw new Error(`Row ${row.rowId}: missing resolved fields (validator should have caught this)`);
      }
      if (row.status === 'update') {
        await deps.snapshots.upsert({ accountId, snapshotDate, totalValue, source });
        updated += 1;
      } else if (row.status === 'new') {
        await deps.snapshots.upsert({ accountId, snapshotDate, totalValue, source });
        inserted += 1;
      } else {
        continue;
      }
    }
    await deps.db.execute('COMMIT');
  } catch (err) {
    await deps.db.execute('ROLLBACK');
    throw err;
  }

  return { inserted, updated, skipped: 0 };
}
