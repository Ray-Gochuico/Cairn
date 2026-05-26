import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('0026_asset_value_snapshots migration', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates the asset_value_snapshots table', async () => {
    const rows = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='asset_value_snapshots'",
    );
    expect(rows).toHaveLength(1);
  });

  it('creates the (owner_type, owner_id, snapshot_date) index', async () => {
    const rows = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_asset_value_snapshots_owner'",
    );
    expect(rows).toHaveLength(1);
  });

  it('enforces the owner_type CHECK', async () => {
    await expect(
      db.execute(
        "INSERT INTO asset_value_snapshots (owner_type, owner_id, snapshot_date, value) VALUES ('FOO', 1, '2026-01-01', 100)",
      ),
    ).rejects.toThrow();
  });

  it('accepts PROPERTY and VEHICLE owner types', async () => {
    await db.execute(
      "INSERT INTO asset_value_snapshots (owner_type, owner_id, snapshot_date, value) VALUES ('PROPERTY', 1, '2026-01-01', 100000)",
    );
    await db.execute(
      "INSERT INTO asset_value_snapshots (owner_type, owner_id, snapshot_date, value) VALUES ('VEHICLE', 2, '2026-02-01', 20000)",
    );
    const rows = (await db.select(
      'SELECT COUNT(*) AS n FROM asset_value_snapshots',
    )) as { n: number }[];
    expect(rows[0].n).toBe(2);
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
