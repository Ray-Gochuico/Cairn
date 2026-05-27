// src/lib/import/commit/property.ts
import type { Database } from '@/db/db';
import type { PropertiesRepo } from '@/domain/properties';
import type { CommitResult, PreviewRow } from '@/lib/import/types';
import type { PropertyResolved } from '@/lib/import/validators/property';

interface Deps {
  db: Database;
  properties: PropertiesRepo;
  householdId: number;
}

/**
 * Commit a batch of validated `property` import rows in a single transaction.
 */
export async function commitPropertyImport(
  rows: ReadonlyArray<PreviewRow<PropertyResolved>>,
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
        await deps.properties.update(row.existingId, payload);
        updated += 1;
      } else if (row.status === 'new') {
        await deps.properties.create(payload);
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
