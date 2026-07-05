/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB query;
 * a load() after settle must re-query (mutations stay visible). Mirrors
 * accounts-store-inflight.test.ts — wave-6 C3 migrates this store onto
 * createDedupedLoad (create-entity-store.ts); fetchData builds the Map.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { RoadmapOverridesRepo } from '@/domain/roadmap-overrides-repo';

describe('useRoadmapOverridesStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useRoadmapOverridesStore.setState({ overridesByNodeId: new Map(), isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent load() calls hit the underlying repo read only once', async () => {
    const spy = vi.spyOn(RoadmapOverridesRepo.prototype, 'list');
    const p1 = useRoadmapOverridesStore.getState().load();
    const p2 = useRoadmapOverridesStore.getState().load();
    await Promise.all([p1, p2]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query', async () => {
    const spy = vi.spyOn(RoadmapOverridesRepo.prototype, 'list');
    await useRoadmapOverridesStore.getState().load();
    await useRoadmapOverridesStore.getState().load();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
