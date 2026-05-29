import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { SettingsRepo } from '@/domain/app-settings';
import { maybeRunLaunchRefresh } from '@/db/init';

// Insert one account_snapshots row so the table is non-empty. The bootstrap
// branch in maybeRunLaunchRefresh only counts rows, so the account FK is
// irrelevant to the gating logic under test — toggle foreign_keys off to skip
// seeding the household -> account chain.
async function seedOneSnapshot(db: SqliteAdapter): Promise<void> {
  await db.execute('PRAGMA foreign_keys = OFF');
  await db.execute(
    "INSERT INTO account_snapshots (account_id, snapshot_date, total_value, source) VALUES (1, '2026-05-01', 1000, 'MANUAL')",
  );
  await db.execute('PRAGMA foreign_keys = ON');
}

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

  it('does NOT re-stamp under DAILY when recently refreshed and snapshots exist', async () => {
    await seedOneSnapshot(db);
    const recent = new Date(Date.now() - 60_000).toISOString();
    await new SettingsRepo(db).update({
      refreshCadence: 'DAILY',
      lastRefreshAt: recent,
    });
    await maybeRunLaunchRefresh(db);
    expect((await new SettingsRepo(db).get()).lastRefreshAt).toBe(recent);
  });

  it('bootstraps a refresh under DAILY when there are zero snapshots, even if recently refreshed', async () => {
    // Forward-only self-heal: after the 0040 wipe a DB can be snapshot-empty
    // with a recent last_refresh_at, which would otherwise leave every
    // value-based view blank until the next calendar day. account_snapshots is
    // empty in a fresh migrated DB (0040 ran against no rows), so no seed here.
    const recent = new Date(Date.now() - 60_000).toISOString();
    await new SettingsRepo(db).update({
      refreshCadence: 'DAILY',
      lastRefreshAt: recent,
    });
    await maybeRunLaunchRefresh(db);
    expect((await new SettingsRepo(db).get()).lastRefreshAt).not.toBe(recent);
  });

  it('does NOT bootstrap under MANUAL even when there are zero snapshots', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    await new SettingsRepo(db).update({
      refreshCadence: 'MANUAL',
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
