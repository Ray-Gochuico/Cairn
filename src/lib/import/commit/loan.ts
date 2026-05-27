// src/lib/import/commit/loan.ts
import type { Database } from '@/db/db';
import type { LoansRepo } from '@/domain/loans';
import type { CommitResult, PreviewRow } from '@/lib/import/types';
import type { LoanResolved } from '@/lib/import/validators/loan';

interface Deps {
  db: Database;
  loans: LoansRepo;
  householdId: number;
}

/**
 * Commit a batch of validated `loan` import rows in a single transaction.
 * householdId from Deps stamps every row, overriding the validator's
 * placeholder value (1).
 */
export async function commitLoanImport(
  rows: ReadonlyArray<PreviewRow<LoanResolved>>,
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
        await deps.loans.update(row.existingId, payload);
        updated += 1;
      } else if (row.status === 'new') {
        await deps.loans.create(payload);
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
