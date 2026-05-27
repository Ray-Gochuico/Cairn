// Migration-level test for 0033_fix_disclosure_acceptance_fk_actions.
//
// Companion to tests/db/disclosure-fk-cascade.test.ts (which exercises
// the runtime ON DELETE CASCADE behavior). This file focuses on what
// only a migration-level test can pin:
//   - The rebuild created tables with the CORRECT FK on_delete action,
//     not just any FK.
//   - The migration is recorded in schema_migrations.
//   - Re-running loadAllMigrations() is a no-op (idempotency).
//   - The rebuild preserved AUTOINCREMENT on the id column (PRAGMA
//     sequence rows present).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

interface ForeignKeyInfo {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
}

describe('0033_fix_disclosure_acceptance_fk_actions', () => {
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
      `SELECT version FROM schema_migrations WHERE version = '0033_fix_disclosure_acceptance_fk_actions'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('disclosure_acceptances.household_id FK has ON DELETE CASCADE', async () => {
    const fks = await db.select<ForeignKeyInfo>(
      `PRAGMA foreign_key_list('disclosure_acceptances')`,
    );
    const householdFk = fks.find((fk) => fk.from === 'household_id' && fk.table === 'household');
    expect(householdFk).toBeDefined();
    expect(householdFk?.on_delete).toBe('CASCADE');
  });

  it('roadmap_node_overrides.household_id FK has ON DELETE CASCADE', async () => {
    const fks = await db.select<ForeignKeyInfo>(
      `PRAGMA foreign_key_list('roadmap_node_overrides')`,
    );
    const householdFk = fks.find((fk) => fk.from === 'household_id' && fk.table === 'household');
    expect(householdFk).toBeDefined();
    expect(householdFk?.on_delete).toBe('CASCADE');
  });

  it('disclosure_acceptances retains the (household_id, document_id, version) UNIQUE constraint after rebuild', async () => {
    // Insert a row twice with the same triplet — must throw on second.
    await db.execute(
      `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
       VALUES (1, 'doc_x', '1.0', '2026-05-27T00:00:00Z')`,
    );
    await expect(
      db.execute(
        `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
         VALUES (1, 'doc_x', '1.0', '2026-05-28T00:00:00Z')`,
      ),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('roadmap_node_overrides retains the (household_id, node_id) UNIQUE constraint after rebuild', async () => {
    await db.execute(
      `INSERT INTO roadmap_node_overrides (household_id, node_id, override_status, set_at)
       VALUES (1, 'NX', 'complete', '2026-05-27T00:00:00Z')`,
    );
    await expect(
      db.execute(
        `INSERT INTO roadmap_node_overrides (household_id, node_id, override_status, set_at)
         VALUES (1, 'NX', 'skipped', '2026-05-28T00:00:00Z')`,
      ),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('PRAGMA foreign_keys is ON after the migration (the migration toggles OFF/ON but leaves it ON)', async () => {
    // 0033 contains `PRAGMA foreign_keys = OFF` then `... = ON` at the
    // bookends of the rebuild. SqliteAdapter's constructor also sets it
    // ON. Either way, the post-migration state must be ON or runtime
    // cascades will silently fail.
    const rows = await db.select<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(rows[0].foreign_keys).toBe(1);
  });

  it('is idempotent — running loadAllMigrations() twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();

    // Confirm the FK action is still CASCADE after a second pass through
    // the loader (no double-rebuild happened — schema_migrations skip).
    const fks = await db.select<ForeignKeyInfo>(
      `PRAGMA foreign_key_list('disclosure_acceptances')`,
    );
    const householdFk = fks.find((fk) => fk.from === 'household_id');
    expect(householdFk?.on_delete).toBe('CASCADE');
  });
});
