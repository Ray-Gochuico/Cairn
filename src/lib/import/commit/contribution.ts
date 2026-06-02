// src/lib/import/commit/contribution.ts
import type { BatchStatement, Database } from '@/db/db';
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

  // Collect every INSERT as a Zod-validated {sql, params} statement, then run
  // them as ONE atomic batch on a single connection. The old BEGIN/body/COMMIT
  // expressed as separate `db.execute` calls wrapped NOTHING under prod's
  // plugin-sql connection POOL. A failing row throws during collection, before
  // any write — preserving "fails on row N ⇒ 0 rows committed, error surfaced".
  const statements: BatchStatement[] = [];
  for (const row of rows) {
    if (row.status === 'error') {
      skipped += 1;
      continue;
    }
    // Both 'new' and 'duplicate' rows that survived the modal's commit
    // filter end up here as inserts.
    statements.push(deps.contributions.buildCreateStatement(row.resolved));
    inserted += 1;
  }

  await deps.db.executeBatch(statements, { transaction: true });

  return { inserted, updated: 0, skipped };
}
