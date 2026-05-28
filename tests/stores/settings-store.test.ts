import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useSettingsStore } from '@/stores/settings-store';

describe('useSettingsStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('loads the settings singleton from the database', async () => {
    await useSettingsStore.getState().load();
    const { settings } = useSettingsStore.getState();
    expect(settings).not.toBeNull();
    expect(settings!.refreshCadence).toBe('DAILY');
  });

  it('updates settings and refreshes state', async () => {
    await useSettingsStore.getState().load();
    await useSettingsStore.getState().update({ notificationDay: 12, refreshCadence: 'DAILY' });
    const { settings } = useSettingsStore.getState();
    expect(settings!.notificationDay).toBe(12);
    expect(settings!.refreshCadence).toBe('DAILY');
  });

  it('sets error state on an invalid update', async () => {
    await useSettingsStore.getState().load();
    try {
      await useSettingsStore.getState().update({ notificationDay: 99 } as never);
    } catch {
      /* expected — update() rethrows */
    }
    expect(useSettingsStore.getState().error).not.toBeNull();
  });
});
