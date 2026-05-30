import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

interface PragmaColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

describe('disclosure foundations (0017 created the table; 0043 retired the cache columns)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('drops the four legacy disclosure cache columns from household (0043, single source of truth)', async () => {
    // 0017 added these four TEXT columns; 0043 dropped them once the gate moved
    // to disclosure_acceptances as the single source of truth (MF-1 + T5). The
    // full migration chain (loadAllMigrations) includes 0043, so after the
    // chain runs the columns must be GONE.
    const info = await db.select<PragmaColumn>("PRAGMA table_info('household')");
    const names = info.map((c) => c.name);

    for (const col of [
      'disclaimer_accepted_at',
      'disclaimer_version_accepted',
      'roadmap_disclaimer_accepted_at',
      'roadmap_disclaimer_version_accepted',
    ]) {
      expect(names, `${col} should be dropped`).not.toContain(col);
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

  it('records an acceptance in disclosure_acceptances (the single source of truth)', async () => {
    // The household row no longer carries acceptance state — acceptance is
    // recorded exclusively in disclosure_acceptances. Seed one and read it back.
    await db.execute(
      `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
       VALUES (1, 'app_wide', '1.5', '2026-05-28T00:00:00Z')`,
    );
    const rows = await db.select<{ document_id: string; version: string }>(
      `SELECT document_id, version FROM disclosure_acceptances WHERE household_id = 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].document_id).toBe('app_wide');
    expect(rows[0].version).toBe('1.5');
  });
});
