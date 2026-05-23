import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { SettingsRepo } from '@/domain/app-settings';

describe('SettingsRepo', () => {
  let db: SqliteAdapter;
  let repo: SettingsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    repo = new SettingsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('reads the seeded singleton with defaults', async () => {
    const s = await repo.get();
    expect(s.id).toBe(1);
    expect(s.notificationsEnabled).toBe(true);
    expect(s.notificationDay).toBe(1);
    expect(s.refreshCadence).toBe('EVERY_LAUNCH');
    expect(s.sidebarLayout).toBeNull();
    expect(s.lastRefreshAt).toBeNull();
    expect(s.statementsFolderPath).toBeNull();
  });

  it('updates scalar fields', async () => {
    await repo.update({
      notificationsEnabled: false,
      notificationDay: 15,
      refreshCadence: 'WEEKLY',
      lastRefreshAt: '2026-05-22T10:00:00.000Z',
      statementsFolderPath: '/Users/me/Statements',
    });
    const s = await repo.get();
    expect(s.notificationsEnabled).toBe(false);
    expect(s.notificationDay).toBe(15);
    expect(s.refreshCadence).toBe('WEEKLY');
    expect(s.lastRefreshAt).toBe('2026-05-22T10:00:00.000Z');
    expect(s.statementsFolderPath).toBe('/Users/me/Statements');
  });

  it('round-trips the sidebarLayout JSON column', async () => {
    const layout = [
      { to: '/', hidden: false },
      { to: '/vehicles', hidden: true },
    ];
    await repo.update({ sidebarLayout: layout });
    expect((await repo.get()).sidebarLayout).toEqual(layout);
    await repo.update({ sidebarLayout: null });
    expect((await repo.get()).sidebarLayout).toBeNull();
  });

  it('a partial patch leaves other fields untouched', async () => {
    await repo.update({ notificationDay: 20 });
    const s = await repo.get();
    expect(s.notificationDay).toBe(20);
    expect(s.refreshCadence).toBe('EVERY_LAUNCH');
  });

  it('rejects an invalid patch', async () => {
    await expect(repo.update({ notificationDay: 99 } as never)).rejects.toThrow();
  });
});
