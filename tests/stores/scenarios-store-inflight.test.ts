/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB query;
 * a load() after settle must re-query (mutations stay visible). Mirrors
 * accounts-store-inflight.test.ts — wave-6 C3 migrates this store onto
 * createDedupedLoad (create-entity-store.ts). The first-boot Baseline seed
 * lives inside fetchData, so the guard also prevents a concurrent
 * double-seed (third test).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useScenariosStore } from '@/stores/scenarios-store';
import { ScenariosRepo } from '@/domain/scenarios';
import { emptyLeverPayload } from '@/lib/scenarios';

describe('useScenariosStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useScenariosStore.setState({ scenarios: [], isLoading: false, error: null });
    // Pre-seed so load() takes the non-seeding path (a cold empty table runs
    // list → create → list inside ONE fetch; the guard still collapses the
    // concurrent CALLS, but the call-count assertion is cleanest non-empty).
    await new ScenariosRepo(db).create({
      name: 'Baseline', isBaseline: true, color: '#4c78a8', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(),
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent load() calls hit the underlying repo read only once', async () => {
    const spy = vi.spyOn(ScenariosRepo.prototype, 'list');
    const p1 = useScenariosStore.getState().load();
    const p2 = useScenariosStore.getState().load();
    await Promise.all([p1, p2]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query', async () => {
    const spy = vi.spyOn(ScenariosRepo.prototype, 'list');
    await useScenariosStore.getState().load();
    await useScenariosStore.getState().load();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('concurrent loads on an EMPTY table seed the baseline exactly once', async () => {
    // Fresh empty DB for this test (the shared beforeEach pre-seeded).
    await db.close();
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useScenariosStore.setState({ scenarios: [], isLoading: false, error: null });
    const createSpy = vi.spyOn(ScenariosRepo.prototype, 'create');
    await Promise.all([
      useScenariosStore.getState().load(),
      useScenariosStore.getState().load(),
    ]);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(useScenariosStore.getState().scenarios).toHaveLength(1);
    createSpy.mockRestore();
  });
});
