import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { SettingsRepo } from '@/domain/app-settings';
import { FiPillsPosition, ProjectionDetailLevel } from '@/types/enums';

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

  it('round-trips defaultInflation and defaultReturnRate through update + get', async () => {
    await repo.update({ defaultInflation: 0.03, defaultReturnRate: 0.08 });
    const s = await repo.get();
    expect(s.defaultInflation).toBeCloseTo(0.03, 5);
    expect(s.defaultReturnRate).toBeCloseTo(0.08, 5);
  });

  it('writes nulls when What-If default fields are cleared', async () => {
    await repo.update({ defaultInflation: 0.04, defaultReturnRate: 0.06 });
    await repo.update({ defaultInflation: null, defaultReturnRate: null });
    const s = await repo.get();
    expect(s.defaultInflation).toBeNull();
    expect(s.defaultReturnRate).toBeNull();
  });

  it('seeds defaultInflation and defaultReturnRate as null on fresh DB', async () => {
    const s = await repo.get();
    expect(s.defaultInflation).toBeNull();
    expect(s.defaultReturnRate).toBeNull();
  });

  it('reads the seeded defaultFiPillsPosition as "above" on a fresh DB', async () => {
    const s = await repo.get();
    expect(s.defaultFiPillsPosition).toBe(FiPillsPosition.ABOVE);
  });

  it('updates and re-reads defaultFiPillsPosition = "below"', async () => {
    await repo.update({ defaultFiPillsPosition: FiPillsPosition.BELOW });
    const s = await repo.get();
    expect(s.defaultFiPillsPosition).toBe(FiPillsPosition.BELOW);
  });

  it('round-trips defaultFiPillsPosition back to "above"', async () => {
    await repo.update({ defaultFiPillsPosition: FiPillsPosition.BELOW });
    await repo.update({ defaultFiPillsPosition: FiPillsPosition.ABOVE });
    const s = await repo.get();
    expect(s.defaultFiPillsPosition).toBe(FiPillsPosition.ABOVE);
  });
});

describe('SettingsRepo — ProjectionDetailLevel', () => {
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

  it('reads default_projection_detail_level as tax_bucket from a fresh DB', async () => {
    const s = await repo.get();
    expect(s.defaultProjectionDetailLevel).toBe('tax_bucket');
  });

  it('round-trips defaultProjectionDetailLevel through update + get', async () => {
    await repo.update({ defaultProjectionDetailLevel: 'per_account' });
    expect((await repo.get()).defaultProjectionDetailLevel).toBe('per_account');

    await repo.update({ defaultProjectionDetailLevel: 'single' });
    expect((await repo.get()).defaultProjectionDetailLevel).toBe('single');

    await repo.update({ defaultProjectionDetailLevel: 'tax_bucket' });
    expect((await repo.get()).defaultProjectionDetailLevel).toBe('tax_bucket');
  });

  it('rejects an invalid defaultProjectionDetailLevel on update', async () => {
    await expect(
      repo.update({ defaultProjectionDetailLevel: 'bogus' as never }),
    ).rejects.toThrow();
  });
});
