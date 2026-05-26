import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('0028_utility_category_config', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('adds property_utilities_category_ids and vehicle_gas_category_ids columns', async () => {
    const rows = await db.select<{ name: string }>(
      "SELECT name FROM pragma_table_info('app_settings') WHERE name IN ('property_utilities_category_ids', 'vehicle_gas_category_ids')",
    );
    expect(rows.map((r) => r.name).sort()).toEqual([
      'property_utilities_category_ids',
      'vehicle_gas_category_ids',
    ]);
  });

  it('defaults both columns to NULL on the existing app_settings row', async () => {
    const rows = (await db.select(
      'SELECT property_utilities_category_ids, vehicle_gas_category_ids FROM app_settings WHERE id = 1',
    )) as Array<{
      property_utilities_category_ids: string | null;
      vehicle_gas_category_ids: string | null;
    }>;
    expect(rows[0].property_utilities_category_ids).toBeNull();
    expect(rows[0].vehicle_gas_category_ids).toBeNull();
  });

  it('accepts JSON-encoded id arrays as TEXT', async () => {
    await db.execute(
      "UPDATE app_settings SET property_utilities_category_ids = '[10,20]', vehicle_gas_category_ids = '[17]' WHERE id = 1",
    );
    const rows = (await db.select(
      'SELECT property_utilities_category_ids, vehicle_gas_category_ids FROM app_settings WHERE id = 1',
    )) as Array<{
      property_utilities_category_ids: string;
      vehicle_gas_category_ids: string;
    }>;
    expect(rows[0].property_utilities_category_ids).toBe('[10,20]');
    expect(rows[0].vehicle_gas_category_ids).toBe('[17]');
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
