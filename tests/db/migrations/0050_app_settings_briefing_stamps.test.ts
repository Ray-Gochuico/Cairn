import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('0050_app_settings_briefing_stamps', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });
  afterEach(async () => { await db.close(); });

  it('adds nullable last_visit_date + briefing_baseline_date columns, NULL on the seed row', async () => {
    const cols = await db.select<{ name: string }>('PRAGMA table_info(app_settings)');
    const names = cols.map((c) => c.name);
    expect(names).toContain('last_visit_date');
    expect(names).toContain('briefing_baseline_date');
    const seed = await db.select<{ last_visit_date: string | null; briefing_baseline_date: string | null }>(
      'SELECT last_visit_date, briefing_baseline_date FROM app_settings WHERE id = 1',
    );
    expect(seed).toHaveLength(1);
    expect(seed[0].last_visit_date).toBeNull();
    expect(seed[0].briefing_baseline_date).toBeNull();
  });

  it('accepts YYYY-MM-DD writes and reads them back', async () => {
    await db.execute(
      "UPDATE app_settings SET last_visit_date = '2026-07-09', briefing_baseline_date = '2026-07-08' WHERE id = 1",
    );
    const r = await db.select<{ last_visit_date: string; briefing_baseline_date: string }>(
      'SELECT last_visit_date, briefing_baseline_date FROM app_settings WHERE id = 1',
    );
    expect(r[0].last_visit_date).toBe('2026-07-09');
    expect(r[0].briefing_baseline_date).toBe('2026-07-08');
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
