// src/lib/import/commit/account.ts
import type { BatchStatement, Database } from '@/db/db';
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
    const payload = { ...row.resolved, householdId: deps.householdId };
    if (row.status === 'update' && row.existingId != null) {
      statements.push(await deps.accounts.buildUpdateStatement(row.existingId, payload));
      updated += 1;
    } else if (row.status === 'new') {
      statements.push(deps.accounts.buildCreateStatement(payload));
      inserted += 1;
    } else {
      skipped += 1;
    }
  }

  await deps.db.executeBatch(statements, { transaction: true });

  return { inserted, updated, skipped };
}
