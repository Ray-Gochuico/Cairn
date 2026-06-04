import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useSettingsStore } from '@/stores/settings-store';
import { __resetImportLatchForTests } from '@/lib/calculator-card-layout';

describe('useSettingsStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    localStorage.clear();
    __resetImportLatchForTests();
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

  it('de-dupes concurrent load() calls into a single repo read', async () => {
    const selectSpy = vi.spyOn(db, 'select');
    await Promise.all([
      useSettingsStore.getState().load(),
      useSettingsStore.getState().load(),
      useSettingsStore.getState().load(),
    ]);
    // One settings SELECT (not three) — concurrent loads share one in-flight.
    const settingsReads = selectSpy.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && /FROM app_settings/i.test(sql),
    );
    expect(settingsReads).toHaveLength(1);
    expect(useSettingsStore.getState().settings).not.toBeNull();
    selectSpy.mockRestore();
  });

  it('imports legacy calculator-hidden-cards once after the first successful load', async () => {
    localStorage.setItem('calculator-hidden-cards', JSON.stringify(['paycheck']));
    await useSettingsStore.getState().load();
    // The post-load import is fire-and-forget; let its microtasks drain.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    const layout = useSettingsStore.getState().settings?.calculatorCardLayout;
    // After import the store may not yet reflect the new layout (import does
    // not re-set the store), but the DB field is written and the key cleared.
    expect(localStorage.getItem('calculator-hidden-cards')).toBeNull();
    // A fresh load now reflects the imported layout.
    await useSettingsStore.getState().load();
    const reloaded = useSettingsStore.getState().settings?.calculatorCardLayout ?? [];
    expect(new Set(reloaded.filter((e) => e.hidden).map((e) => e.id))).toEqual(
      new Set(['paycheck']),
    );
    // `layout` captured pre-reload is intentionally unused beyond documenting
    // that the store isn't force-refreshed by the import.
    void layout;
  });
});
