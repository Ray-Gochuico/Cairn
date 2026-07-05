/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB query;
 * a load() after settle must re-query (mutations stay visible). Snapshots'
 * load is a raw getDatabase().select(...) + Zod parse (no repo read), so the
 * spy sits on the adapter's select. It attaches AFTER beforeEach's
 * migrations ran, so the count only sees the loads. Wave-6 C3 migrates this
 * store onto createDedupedLoad (create-entity-store.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useSnapshotsStore } from '@/stores/snapshots-store';

describe('useSnapshotsStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent load() calls hit the underlying select only once', async () => {
    const spy = vi.spyOn(SqliteAdapter.prototype, 'select');
    const p1 = useSnapshotsStore.getState().load();
    const p2 = useSnapshotsStore.getState().load();
    await Promise.all([p1, p2]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query', async () => {
    const spy = vi.spyOn(SqliteAdapter.prototype, 'select');
    await useSnapshotsStore.getState().load();
    await useSnapshotsStore.getState().load();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
