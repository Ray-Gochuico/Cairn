import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { SettingsRepo } from '@/domain/app-settings';
import { maybeRunLaunchRefresh } from '@/db/init';

describe('maybeRunLaunchRefresh', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('stamps last_refresh_at when a refresh is due (EVERY_LAUNCH default)', async () => {
    expect((await new SettingsRepo(db).get()).lastRefreshAt).toBeNull();
    await maybeRunLaunchRefresh(db);
    const after = await new SettingsRepo(db).get();
    expect(after.lastRefreshAt).not.toBeNull();
    // A well-formed ISO timestamp.
    expect(Number.isNaN(Date.parse(after.lastRefreshAt as string))).toBe(false);
  });

  it('does NOT stamp last_refresh_at when the cadence is MANUAL', async () => {
    await new SettingsRepo(db).update({ refreshCadence: 'MANUAL' });
    await maybeRunLaunchRefresh(db);
    expect((await new SettingsRepo(db).get()).lastRefreshAt).toBeNull();
  });

  it('does NOT re-stamp under DAILY when the last refresh was minutes ago', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    await new SettingsRepo(db).update({
      refreshCadence: 'DAILY',
      lastRefreshAt: recent,
    });
    await maybeRunLaunchRefresh(db);
    expect((await new SettingsRepo(db).get()).lastRefreshAt).toBe(recent);
  });

  it('re-stamps under DAILY when the last refresh was over a day ago', async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await new SettingsRepo(db).update({
      refreshCadence: 'DAILY',
      lastRefreshAt: stale,
    });
    await maybeRunLaunchRefresh(db);
    expect((await new SettingsRepo(db).get()).lastRefreshAt).not.toBe(stale);
  });
});
