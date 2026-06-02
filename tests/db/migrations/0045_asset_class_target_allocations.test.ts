import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('0045_asset_class_target_allocations', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });
  afterEach(async () => {
    await db.close();
  });

  it('adds a nullable asset_class_target_allocations column to app_settings', async () => {
    const rows = await db.select<{ name: string; notnull: number }>(
      "SELECT name, \"notnull\" FROM pragma_table_info('app_settings') WHERE name = 'asset_class_target_allocations'",
    );
    expect(rows.map((r) => r.name)).toEqual(['asset_class_target_allocations']);
    expect(rows[0].notnull).toBe(0); // nullable
  });

  it('seeds the singleton row with NULL (no class targets)', async () => {
    const rows = await db.select<{ v: string | null }>(
      'SELECT asset_class_target_allocations AS v FROM app_settings WHERE id = 1',
    );
    expect(rows[0].v).toBeNull();
  });

  it('round-trips a raw JSON value at the SQL level', async () => {
    const json = JSON.stringify([{ assetClass: 'US_BONDS', targetPct: 0.4 }]);
    await db.execute('UPDATE app_settings SET asset_class_target_allocations = ? WHERE id = 1', [json]);
    const rows = await db.select<{ v: string }>(
      'SELECT asset_class_target_allocations AS v FROM app_settings WHERE id = 1',
    );
    expect(JSON.parse(rows[0].v)).toEqual([{ assetClass: 'US_BONDS', targetPct: 0.4 }]);
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
