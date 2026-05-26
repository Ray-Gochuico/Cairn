import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const loadAssetSnapshotsMigration = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0026_asset_value_snapshots.sql'),
    'utf-8',
  );

const samplePropertySnapshot = {
  ownerType: 'PROPERTY' as const,
  ownerId: 1,
  snapshotDate: '2026-04-01',
  value: 425000,
};

describe('useAssetValueSnapshotsStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0026_asset_value_snapshots', sql: loadAssetSnapshotsMigration() },
    ]);
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

  it('initial state is empty with no loading and no error', () => {
    const { assetValueSnapshots, isLoading, error } =
      useAssetValueSnapshotsStore.getState();
    expect(assetValueSnapshots).toEqual([]);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('load() populates assetValueSnapshots from the database', async () => {
    // Seed directly via DB so we don't depend on the store's create path
    await db.execute(
      `INSERT INTO asset_value_snapshots (owner_type, owner_id, snapshot_date, value)
       VALUES ('PROPERTY', 1, '2026-01-01', 400000)`,
    );

    await useAssetValueSnapshotsStore.getState().load();
    const { assetValueSnapshots, isLoading, error } =
      useAssetValueSnapshotsStore.getState();
    expect(assetValueSnapshots).toHaveLength(1);
    expect(assetValueSnapshots[0].value).toBe(400000);
    expect(assetValueSnapshots[0].ownerType).toBe('PROPERTY');
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('create() persists the snapshot and refreshes the cache', async () => {
    const id = await useAssetValueSnapshotsStore
      .getState()
      .create(samplePropertySnapshot);
    expect(id).toBeGreaterThan(0);

    const { assetValueSnapshots } = useAssetValueSnapshotsStore.getState();
    expect(assetValueSnapshots).toHaveLength(1);
    expect(assetValueSnapshots[0].id).toBe(id);
    expect(assetValueSnapshots[0].value).toBe(425000);
  });

  it('update() mutates persisted fields and refreshes', async () => {
    const id = await useAssetValueSnapshotsStore
      .getState()
      .create(samplePropertySnapshot);

    await useAssetValueSnapshotsStore.getState().update(id, { value: 430000 });

    const { assetValueSnapshots } = useAssetValueSnapshotsStore.getState();
    expect(assetValueSnapshots[0].value).toBe(430000);
    expect(assetValueSnapshots[0].snapshotDate).toBe('2026-04-01'); // unchanged
  });

  it('remove() deletes the snapshot and refreshes', async () => {
    const id = await useAssetValueSnapshotsStore
      .getState()
      .create(samplePropertySnapshot);
    expect(useAssetValueSnapshotsStore.getState().assetValueSnapshots).toHaveLength(1);

    await useAssetValueSnapshotsStore.getState().remove(id);
    expect(useAssetValueSnapshotsStore.getState().assetValueSnapshots).toEqual([]);
  });

  it('removeForOwner() clears all snapshots for one entity and refreshes', async () => {
    await useAssetValueSnapshotsStore.getState().create({
      ownerType: 'PROPERTY',
      ownerId: 1,
      snapshotDate: '2026-01-01',
      value: 400000,
    });
    await useAssetValueSnapshotsStore.getState().create({
      ownerType: 'PROPERTY',
      ownerId: 2,
      snapshotDate: '2026-01-01',
      value: 300000,
    });
    expect(useAssetValueSnapshotsStore.getState().assetValueSnapshots).toHaveLength(2);

    await useAssetValueSnapshotsStore.getState().removeForOwner('PROPERTY', 1);
    const { assetValueSnapshots } = useAssetValueSnapshotsStore.getState();
    expect(assetValueSnapshots).toHaveLength(1);
    expect(assetValueSnapshots[0].ownerId).toBe(2);
  });

  it('load() swallows DB errors into state.error (does NOT rethrow)', async () => {
    await db.close();

    await expect(
      useAssetValueSnapshotsStore.getState().load(),
    ).resolves.toBeUndefined();

    const { error, isLoading } = useAssetValueSnapshotsStore.getState();
    expect(error).not.toBeNull();
    expect(isLoading).toBe(false);
  });

  it('create() rethrows on validation failure', async () => {
    await expect(
      useAssetValueSnapshotsStore.getState().create({
        ...samplePropertySnapshot,
        value: -1, // schema rejects negative
      }),
    ).rejects.toThrow();
  });
});
