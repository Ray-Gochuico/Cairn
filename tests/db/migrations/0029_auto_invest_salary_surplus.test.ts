import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('0029_auto_invest_salary_surplus', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('adds the auto_invest_salary_surplus column to app_settings', async () => {
    const rows = await db.select<{ name: string; notnull: number; dflt_value: string | null }>(
      "SELECT name, \"notnull\", dflt_value FROM pragma_table_info('app_settings') WHERE name = 'auto_invest_salary_surplus'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].notnull).toBe(1);
    expect(rows[0].dflt_value).toBe('0');
  });

  it('defaults to 0 (off) on the pre-existing app_settings row', async () => {
    const rows = await db.select<{ auto_invest_salary_surplus: number }>(
      'SELECT auto_invest_salary_surplus FROM app_settings WHERE id = 1',
    );
    expect(rows[0].auto_invest_salary_surplus).toBe(0);
  });

  it('accepts 0 and 1 as valid values', async () => {
    await db.execute('UPDATE app_settings SET auto_invest_salary_surplus = 1 WHERE id = 1');
    const rows = await db.select<{ auto_invest_salary_surplus: number }>(
      'SELECT auto_invest_salary_surplus FROM app_settings WHERE id = 1',
    );
    expect(rows[0].auto_invest_salary_surplus).toBe(1);
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
