/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB query.
 * Re-load after settle must trigger a new DB query (so mutations remain visible).
 * Pattern: tests/stores/persons-store-inflight.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { usePropertiesStore } from '@/stores/properties-store';
import { PropertiesRepo } from '@/domain/properties';

describe('usePropertiesStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent load() calls hit the underlying repo list() only once', async () => {
    const listSpy = vi.spyOn(PropertiesRepo.prototype, 'list');
    const p1 = usePropertiesStore.getState().load();
    const p2 = usePropertiesStore.getState().load();
    await Promise.all([p1, p2]);
    expect(listSpy).toHaveBeenCalledTimes(1);
    listSpy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query', async () => {
    const listSpy = vi.spyOn(PropertiesRepo.prototype, 'list');
    await usePropertiesStore.getState().load();
    await usePropertiesStore.getState().load();
    expect(listSpy).toHaveBeenCalledTimes(2);
    listSpy.mockRestore();
  });
});
