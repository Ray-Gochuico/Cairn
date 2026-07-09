// src/lib/import/commit.ts
import type { BatchStatement, Database } from '@/db/db';
import type { AccountSnapshotsRepo } from '@/domain/snapshots';
import type { TransactionsRepo } from '@/domain/transactions';
import type { CommitResult, PreviewRow } from '@/lib/import/types';
import type { SnapshotResolved } from '@/lib/import/validators/snapshot-validator';
import type { TransactionResolved } from '@/lib/import/validators/transaction-validator';
import type { SnapshotSource } from '@/types/enums';

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

  // Collect every write as a {sql, params} statement (Zod-validated by the
  // repo's builder), THEN run them as ONE atomic batch on a single
  // connection. The previous BEGIN/body/COMMIT expressed as separate
  // `db.execute` calls wrapped NOTHING in prod (the plugin-sql connection
  // POOL scatters each call across connections), so a mid-batch failure left
  // partial rows committed. A builder throwing here (bad row) happens before
  // any write, so nothing is committed and the error surfaces — same
  // "fails on row N ⇒ 0 rows committed" contract, now genuinely atomic.
  const statements: BatchStatement[] = [];
  for (const row of rows) {
    const { accountId, snapshotDate, totalValue, source } = row.resolved;
    if (accountId === undefined || snapshotDate === undefined || totalValue === undefined) {
      throw new Error(`Row ${row.rowId}: missing resolved fields (validator should have caught this)`);
    }
    if (row.status === 'update') {
      statements.push(
        deps.snapshots.buildUpsertStatement({ accountId, snapshotDate, totalValue, source: source as SnapshotSource }),
      );
      updated += 1;
    } else if (row.status === 'new') {
      statements.push(
        deps.snapshots.buildUpsertStatement({ accountId, snapshotDate, totalValue, source: source as SnapshotSource }),
      );
      inserted += 1;
    } else {
      continue;
    }
  }

  await deps.db.executeBatch(statements, { transaction: true });

  return { inserted, updated, skipped: 0 };
}

/**
 * Write a batch of validated transaction rows in a single SQL transaction.
 * Throws (and rolls back) if any row fails.
 *
 * The transactions table does not yet carry a source column, so
 * TransactionResolved.source is dropped on insert; it lives only in the
 * preview for now (a future migration may add it back).
 */
export async function commitTransactionImport(
  rows: ReadonlyArray<PreviewRow<TransactionResolved>>,
  deps: { db: Database; transactions: TransactionsRepo; householdId: number },
): Promise<CommitResult> {
  let inserted = 0;

  if (rows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  // Collect every INSERT as a Zod-validated {sql, params} statement, then run
  // them as ONE atomic batch on a single connection (the old BEGIN/body/COMMIT
  // as separate `db.execute` calls wrapped nothing under prod's connection
  // pool). A bad row throws during collection, before any write — preserving
  // the "fails on row N ⇒ 0 rows committed, error surfaced" contract.
  const statements: BatchStatement[] = [];
  for (const row of rows) {
    if (row.status === 'error') continue;
    const {
      accountId, date, amount, merchant, categoryId, reimbursable,
      reimbursedAt, reimbursedAmount, personId,
    } = row.resolved;
    if (
      accountId === undefined
      || date === undefined
      || amount === undefined
      || merchant === undefined
    ) {
      throw new Error(`Row ${row.rowId}: missing resolved fields (validator should have caught this)`);
    }
    statements.push(
      deps.transactions.buildCreateStatement({
        householdId: deps.householdId,
        date,
        merchant,
        merchantRaw: null,
        amount,
        categoryId: categoryId ?? null,
        sourceAccountId: accountId,
        propertyId: null,
        vehicleId: null,
        personId,
        sourcePdfFilename: null,
        reimbursable,
        reimbursedAt: reimbursedAt ?? null,
        reimbursedAmount: reimbursedAmount ?? null,
        isRecurring: false,
        notes: null,
      }),
    );
    inserted += 1;
  }

  await deps.db.executeBatch(statements, { transaction: true });

  return { inserted, updated: 0, skipped: 0 };
}
