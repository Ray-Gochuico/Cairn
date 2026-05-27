// src/lib/import/commit/holding.ts
import type { Database } from '@/db/db';
import type { HoldingsRepo } from '@/domain/holdings';
import type { CommitResult, PreviewRow } from '@/lib/import/types';
import type { HoldingResolved } from '@/lib/import/validators/holding';

interface Deps {
  db: Database;
  holdings: HoldingsRepo;
}

/**
 * Commit a batch of validated `holding` import rows in a single transaction.
 * See commit/account.ts for status-semantics docstring (same pattern).
 */
export async function commitHoldingImport(
  rows: ReadonlyArray<PreviewRow<HoldingResolved>>,
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
        await deps.holdings.update(row.existingId, row.resolved);
        updated += 1;
      } else if (row.status === 'new') {
        await deps.holdings.create(row.resolved);
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
