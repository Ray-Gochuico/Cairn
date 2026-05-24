import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

interface PragmaColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

interface HouseholdRow {
  id: number;
  disclaimer_accepted_at: string | null;
  disclaimer_version_accepted: string | null;
  roadmap_disclaimer_accepted_at: string | null;
  roadmap_disclaimer_version_accepted: string | null;
}

describe('disclosure-foundations migration (0017)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('adds 4 nullable TEXT columns to household', async () => {
    const info = await db.select<PragmaColumn>("PRAGMA table_info('household')");
    const byName = new Map(info.map((c) => [c.name, c]));

    for (const col of [
      'disclaimer_accepted_at',
      'disclaimer_version_accepted',
      'roadmap_disclaimer_accepted_at',
      'roadmap_disclaimer_version_accepted',
    ]) {
      const c = byName.get(col);
      expect(c, `${col} should exist`).toBeDefined();
      expect(c!.type).toBe('TEXT');
      expect(c!.notnull, `${col} should be nullable`).toBe(0);
    }
  });

  it('creates disclosure_acceptances table with the expected shape', async () => {
    const info = await db.select<PragmaColumn>("PRAGMA table_info('disclosure_acceptances')");
    const byName = new Map(info.map((c) => [c.name, c]));
    expect(byName.get('id')?.type).toBe('INTEGER');
    expect(byName.get('household_id')?.notnull).toBe(1);
    expect(byName.get('document_id')?.notnull).toBe(1);
    expect(byName.get('version')?.notnull).toBe(1);
    expect(byName.get('accepted_at')?.notnull).toBe(1);
  });

  it('enforces UNIQUE(household_id, document_id, version) on disclosure_acceptances', async () => {
    await db.execute(
      `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
       VALUES (1, 'app_wide', '1.0', '2026-05-23T00:00:00Z')`,
    );
    // Different timestamp, same (household, document, version) — must violate UNIQUE.
    await expect(
      db.execute(
        `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
         VALUES (1, 'app_wide', '1.0', '2026-05-24T00:00:00Z')`,
      ),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('allows multiple versions of the same document (1.0 then 1.1)', async () => {
    await db.execute(
      `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
       VALUES (1, 'app_wide', '1.0', '2026-05-23T00:00:00Z')`,
    );
    await db.execute(
      `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
       VALUES (1, 'app_wide', '1.1', '2026-05-24T00:00:00Z')`,
    );
    const rows = await db.select<{ count: number }>(
      `SELECT COUNT(*) as count FROM disclosure_acceptances`,
    );
    expect(rows[0].count).toBe(2);
  });

  it('leaves the seeded household row with NULL disclosure columns', async () => {
    const rows = await db.select<HouseholdRow>(`SELECT * FROM household WHERE id = 1`);
    expect(rows.length).toBe(1);
    expect(rows[0].disclaimer_accepted_at).toBeNull();
    expect(rows[0].disclaimer_version_accepted).toBeNull();
    expect(rows[0].roadmap_disclaimer_accepted_at).toBeNull();
    expect(rows[0].roadmap_disclaimer_version_accepted).toBeNull();
  });
});
