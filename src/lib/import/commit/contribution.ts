// src/lib/import/commit/contribution.ts
import type { Database } from '@/db/db';
import type { ContributionsRepo } from '@/domain/contributions';
import type { CommitResult, PreviewRow } from '@/lib/import/types';
import type { ContributionResolved } from '@/lib/import/validators/contribution';

interface Deps {
  db: Database;
  contributions: ContributionsRepo;
}

/**
 * Commit a batch of validated `contribution` import rows. Contributions
 * are append-only (no UPDATE path) so we only insert. Duplicate rows
 * flow through the conflict-mode selector in the preview modal: 'update'
 * mode appends another row, 'skip' mode skips the duplicate.
 */
export async function commitContributionImport(
  rows: ReadonlyArray<PreviewRow<ContributionResolved>>,
  deps: Deps,
): Promise<CommitResult> {
  let inserted = 0;
  let skipped = 0;

  if (rows.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  await deps.db.execute('BEGIN');
  try {
    for (const row of rows) {
      if (row.status === 'error') {
        skipped += 1;
        continue;
      }
      // Both 'new' and 'duplicate' rows that survived the modal's commit
      // filter end up here as inserts.
      await deps.contributions.create(row.resolved);
      inserted += 1;
    }
    await deps.db.execute('COMMIT');
  } catch (err) {
    await deps.db.execute('ROLLBACK');
    throw err;
  }

  return { inserted, updated: 0, skipped };
}
