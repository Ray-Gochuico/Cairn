/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB query;
 * a load() after settle must re-query (mutations stay visible). Settings is
 * a singleton — its repo read is get(), not list() (mirrors
 * household-store-inflight.test.ts). Wave-6 C3 migrates this store onto
 * createDedupedLoad (create-entity-store.ts); the fire-and-forget legacy
 * calc-visibility import stays on the success path inside fetchData.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useSettingsStore } from '@/stores/settings-store';
import { SettingsRepo } from '@/domain/app-settings';

describe('useSettingsStore in-flight de-dupe', () => {
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

  it('two concurrent load() calls hit the underlying repo read only once', async () => {
    const spy = vi.spyOn(SettingsRepo.prototype, 'get');
    const p1 = useSettingsStore.getState().load();
    const p2 = useSettingsStore.getState().load();
    await Promise.all([p1, p2]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query', async () => {
    const spy = vi.spyOn(SettingsRepo.prototype, 'get');
    await useSettingsStore.getState().load();
    await useSettingsStore.getState().load();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
