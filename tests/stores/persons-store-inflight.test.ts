/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB query.
 * Re-load after settle must trigger a new DB query (so mutations remain visible).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { usePersonsStore } from '@/stores/persons-store';
import { PersonsRepo } from '@/domain/persons';

describe('usePersonsStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent load() calls hit the underlying repo list() only once', async () => {
    // Spy BEFORE the calls so we see the real method.
    const listSpy = vi.spyOn(PersonsRepo.prototype, 'list');

    // Fire two concurrent loads without awaiting either.
    const p1 = usePersonsStore.getState().load();
    const p2 = usePersonsStore.getState().load();

    await Promise.all([p1, p2]);

    expect(listSpy).toHaveBeenCalledTimes(1);
    listSpy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query (re-load still works)', async () => {
    const listSpy = vi.spyOn(PersonsRepo.prototype, 'list');

    // First load
    await usePersonsStore.getState().load();
    // Second load — after settle → must be a fresh query
    await usePersonsStore.getState().load();

    expect(listSpy).toHaveBeenCalledTimes(2);
    listSpy.mockRestore();
  });
});
