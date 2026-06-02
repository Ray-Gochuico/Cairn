import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

describe('0046_app_settings_last_seen_month', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });
  afterEach(async () => { await db.close(); });

  it('adds a nullable last_seen_month column to app_settings, NULL on the seed row', async () => {
    const cols = await db.select<{ name: string }>('PRAGMA table_info(app_settings)');
    expect(cols.map((c) => c.name)).toContain('last_seen_month');
    const seed = await db.select<{ last_seen_month: string | null }>(
      'SELECT last_seen_month FROM app_settings WHERE id = 1',
    );
    expect(seed).toHaveLength(1);
    expect(seed[0].last_seen_month).toBeNull();
  });

  it('accepts a YYYY-MM write and reads it back', async () => {
    await db.execute("UPDATE app_settings SET last_seen_month = '2026-06' WHERE id = 1");
    const r = await db.select<{ last_seen_month: string }>(
      'SELECT last_seen_month FROM app_settings WHERE id = 1',
    );
    expect(r[0].last_seen_month).toBe('2026-06');
  });

  it('is idempotent — running loadAllMigrations twice does not error', async () => {
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
  });
});
