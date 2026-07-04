/**
 * In-flight de-dupe for the shared asset-value-snapshots store. Every
 * Property/Vehicle card mounts against this ONE store, so a page of N cards
 * previously fired N concurrent list() queries on mount.
 * Pattern: tests/stores/persons-store-inflight.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { AssetValueSnapshotsRepo } from '@/domain/asset-value-snapshots';

describe('useAssetValueSnapshotsStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAssetValueSnapshotsStore.setState({
      assetValueSnapshots: [],
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent load() calls hit the underlying repo list() only once', async () => {
    const listSpy = vi.spyOn(AssetValueSnapshotsRepo.prototype, 'list');
    const p1 = useAssetValueSnapshotsStore.getState().load();
    const p2 = useAssetValueSnapshotsStore.getState().load();
    await Promise.all([p1, p2]);
    expect(listSpy).toHaveBeenCalledTimes(1);
    listSpy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query', async () => {
    const listSpy = vi.spyOn(AssetValueSnapshotsRepo.prototype, 'list');
    await useAssetValueSnapshotsStore.getState().load();
    await useAssetValueSnapshotsStore.getState().load();
    expect(listSpy).toHaveBeenCalledTimes(2);
    listSpy.mockRestore();
  });
});
