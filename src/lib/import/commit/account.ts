// src/lib/import/commit/account.ts
import type { Database } from '@/db/db';
import type { AccountsRepo } from '@/domain/accounts';
import type { CommitResult, PreviewRow } from '@/lib/import/types';
import type { AccountResolved } from '@/lib/import/validators/account';

interface Deps {
  db: Database;
  accounts: AccountsRepo;
  householdId: number;
}

/**
 * Commit a batch of validated `account` import rows. Wraps the whole batch
 * in a single SQL transaction so a mid-batch failure rolls back.
 *
 * status semantics — mirrors commitSnapshotImport:
 *   'new'        → INSERT via AccountsRepo.create
 *   'update'     → UPDATE via AccountsRepo.update(existingId, ...)
 *   'duplicate'  → skipped (not used for accounts; here for completeness)
 *   'error'      → skipped (preview filters these out before commit)
 *
 * `householdId` from Deps stamps every row, overriding the placeholder
 * value (1) that the validator wrote into resolved.
 */
export async function commitAccountImport(
  rows: ReadonlyArray<PreviewRow<AccountResolved>>,
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
      const payload = { ...row.resolved, householdId: deps.householdId };
      if (row.status === 'update' && row.existingId != null) {
        await deps.accounts.update(row.existingId, payload);
        updated += 1;
      } else if (row.status === 'new') {
        await deps.accounts.create(payload);
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
