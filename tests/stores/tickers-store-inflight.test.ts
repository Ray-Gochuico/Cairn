/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB query;
 * a load() after settle must re-query (mutations stay visible). Mirrors
 * accounts-store-inflight.test.ts — wave-6 C3 migrates this store onto
 * createDedupedLoad (create-entity-store.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useTickersStore } from '@/stores/tickers-store';
import { TickersRepo } from '@/domain/tickers';

describe('useTickersStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useTickersStore.setState({ tickers: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent load() calls hit the underlying repo read only once', async () => {
    const spy = vi.spyOn(TickersRepo.prototype, 'list');
    const p1 = useTickersStore.getState().load();
    const p2 = useTickersStore.getState().load();
    await Promise.all([p1, p2]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query', async () => {
    const spy = vi.spyOn(TickersRepo.prototype, 'list');
    await useTickersStore.getState().load();
    await useTickersStore.getState().load();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
