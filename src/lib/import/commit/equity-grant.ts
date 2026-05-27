// src/lib/import/commit/equity-grant.ts
import type { Database } from '@/db/db';
import type { EquityGrantsRepo } from '@/domain/equity-grants';
import type { CommitResult, PreviewRow } from '@/lib/import/types';
import type { EquityGrantResolved } from '@/lib/import/validators/equity-grant';

interface Deps {
  db: Database;
  equityGrants: EquityGrantsRepo;
  householdId: number;
}

/**
 * Commit a batch of validated `equity_grant` import rows in a single
 * transaction. The repo's create / update both round-trip the vesting
 * schedule through EquityGrantSchema.parse() — the validator's
 * pre-parsed payload re-validates harmlessly there as a belt-and-braces
 * check (matches conventions.md's "validate via Zod on every repo write"
 * rule).
 */
export async function commitEquityGrantImport(
  rows: ReadonlyArray<PreviewRow<EquityGrantResolved>>,
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
        await deps.equityGrants.update(row.existingId, payload);
        updated += 1;
      } else if (row.status === 'new') {
        await deps.equityGrants.create(payload);
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
