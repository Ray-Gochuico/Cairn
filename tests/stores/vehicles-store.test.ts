import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';

const todayIso = new Date().toISOString().slice(0, 10);

// Full VehicleSchema shape (src/types/schema.ts): parallels Property but with
// year/make/model instead of type/address.
const baseVehicle = {
  householdId: 1,
  ownerPersonId: null,
  name: 'Car',
  year: 2022,
  make: null,
  model: null,
  purchaseDate: null,
  purchasePrice: null,
  currentEstimatedValue: 20_000,
  linkedLoanId: null,
  excludedFromNetWorth: false,
};

async function snapshotRows(db: SqliteAdapter) {
  return db.select<{ snapshot_date: string; value: number }>(
    `SELECT snapshot_date, value FROM asset_value_snapshots WHERE owner_type='VEHICLE' ORDER BY id`,
  );
}

describe("vehicles-store — estimate edits write today's value snapshot (Wave 2 §4)", () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
    useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('create does NOT write a snapshot (new entities keep est. semantics)', async () => {
    await useVehiclesStore.getState().create(baseVehicle);
    expect(await snapshotRows(db)).toHaveLength(0);
  });

  it('updating the estimate upserts a snapshot dated today', async () => {
    const id = await useVehiclesStore.getState().create(baseVehicle);
    await useVehiclesStore.getState().update(id, { currentEstimatedValue: 18_500 });
    const rows = await snapshotRows(db);
    expect(rows).toEqual([{ snapshot_date: todayIso, value: 18_500 }]);
    // Live surfaces read the asset store — it must reflect the row too.
    expect(
      useAssetValueSnapshotsStore.getState().assetValueSnapshots
        .find((s) => s.ownerType === 'VEHICLE' && s.ownerId === id && s.snapshotDate === todayIso)?.value,
    ).toBe(18_500);
  });

  it('a second same-day edit updates the SAME row (no duplicates)', async () => {
    const id = await useVehiclesStore.getState().create(baseVehicle);
    await useVehiclesStore.getState().update(id, { currentEstimatedValue: 18_500 });
    await useVehiclesStore.getState().update(id, { currentEstimatedValue: 18_000 });
    const rows = await snapshotRows(db);
    expect(rows).toEqual([{ snapshot_date: todayIso, value: 18_000 }]);
  });

  it('an unchanged estimate in a full-form save does NOT write a snapshot', async () => {
    const id = await useVehiclesStore.getState().create(baseVehicle);
    // Tabs submit the whole form — the estimate rides along unchanged.
    await useVehiclesStore.getState().update(id, { name: 'Family car', currentEstimatedValue: 20_000 });
    expect(await snapshotRows(db)).toHaveLength(0);
  });

  it('a patch without the estimate, or clearing it to null, does NOT write a snapshot', async () => {
    const id = await useVehiclesStore.getState().create(baseVehicle);
    await useVehiclesStore.getState().update(id, { name: 'Renamed' });
    await useVehiclesStore.getState().update(id, { currentEstimatedValue: null });
    expect(await snapshotRows(db)).toHaveLength(0);
  });
});
