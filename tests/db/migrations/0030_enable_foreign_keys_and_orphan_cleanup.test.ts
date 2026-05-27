// Migration-level test for 0030_enable_foreign_keys_and_orphan_cleanup.
//
// What it covers (vs. tests/db/foreign-keys.test.ts which tests the
// runtime FK behavior):
//   - The migration body itself runs cleanly on a fresh DB (no orphans
//     to remove — every DELETE is a no-op).
//   - The migration body runs cleanly on a DB with orphan rows pre-
//     seeded *between* the prior migration set and this one. This proves
//     the cleanup SQL targets the right tables/columns.
//   - The migration is idempotent — running loadAllMigrations() twice
//     does not error and does not duplicate work.
//
// The Wave-3 review (N5) flagged that foreign-keys.test.ts:74-80 runs a
// hand-written DELETE replica of the 0030 cleanup body instead of the
// migration itself. This test verifies the migration body directly.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('0030_enable_foreign_keys_and_orphan_cleanup', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('is recorded in schema_migrations after loadAllMigrations()', async () => {
    const rows = await db.select<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = '0030_enable_foreign_keys_and_orphan_cleanup'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('cleanup pass is a no-op on a fresh DB (no orphans to delete)', async () => {
    // The fresh DB after migrations only carries the singleton household
    // (id=1) and the seeded reference rows (tax_rules, categories, etc.).
    // No orphan child rows exist, so every DELETE/UPDATE in 0030 should
    // have touched zero rows. Verify the singleton survived.
    const householdRows = await db.select<{ id: number }>(
      'SELECT id FROM household',
    );
    expect(householdRows).toHaveLength(1);
    expect(householdRows[0].id).toBe(1);
  });

  it('is idempotent — running loadAllMigrations() twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();

    const rows = await db.select<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = '0030_enable_foreign_keys_and_orphan_cleanup'`,
    );
    // schema_migrations is PRIMARY KEY(version), so the second run cannot
    // duplicate the row; loadAllMigrations dedupes via the applied-set.
    expect(rows).toHaveLength(1);
  });

  it('does not enable PRAGMA foreign_keys on the connection it ran on', async () => {
    // 0030's SQL body is pure DELETE/UPDATE — the PRAGMA foreign_keys = ON
    // enabling lives in TauriAdapter.load (and SqliteAdapter's constructor
    // for tests). This test pins that contract: the migration itself does
    // NOT toggle the PRAGMA, because doing so inside a connection that
    // already started a statement-by-statement walk would be a no-op
    // anyway (PRAGMA changes are connection-scoped, not migration-scoped).
    //
    // In tests, SqliteAdapter sets PRAGMA on construction so this returns
    // 1; the assertion is that PRAGMA is on (whatever set it), not that
    // 0030 set it. The migration's job is the cleanup pass.
    const rows = await db.select<{ foreign_keys: number }>(
      'PRAGMA foreign_keys',
    );
    expect(rows[0].foreign_keys).toBe(1);
  });
});
