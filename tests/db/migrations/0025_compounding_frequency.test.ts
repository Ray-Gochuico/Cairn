import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';

describe('0025_compounding_frequency migration', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('adds the default_compounding_frequency column to app_settings', async () => {
    const cols = await db.select<{ name: string }>('PRAGMA table_info(app_settings)');
    expect(cols.map((c) => c.name)).toContain('default_compounding_frequency');
  });

  it('seeds the singleton row with default value "MONTHLY"', async () => {
    const rows = await db.select<{ default_compounding_frequency: string }>(
      'SELECT default_compounding_frequency FROM app_settings WHERE id = 1',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].default_compounding_frequency).toBe('MONTHLY');
  });

  it('accepts all five allowed values via UPDATE', async () => {
    for (const value of ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY']) {
      await db.execute(
        'UPDATE app_settings SET default_compounding_frequency = ? WHERE id = 1',
        [value],
      );
      const rows = await db.select<{ default_compounding_frequency: string }>(
        'SELECT default_compounding_frequency FROM app_settings WHERE id = 1',
      );
      expect(rows[0].default_compounding_frequency).toBe(value);
    }
  });

  it('CHECK constraint rejects unknown frequency values', async () => {
    await expect(
      db.execute(
        "UPDATE app_settings SET default_compounding_frequency = 'YEARLY' WHERE id = 1",
      ),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
