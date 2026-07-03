import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { usePropertiesStore } from '@/stores/properties-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { PropertyType } from '@/types/enums';

const todayIso = new Date().toISOString().slice(0, 10);

const baseProperty = {
  householdId: 1,
  ownerPersonId: null,
  name: 'Home',
  type: PropertyType.PRIMARY_RESIDENCE,
  address: null,
  purchaseDate: null,
  purchasePrice: null,
  currentEstimatedValue: 400_000,
  linkedLoanId: null,
  excludedFromNetWorth: false,
};

async function snapshotRows(db: SqliteAdapter) {
  return db.select<{ snapshot_date: string; value: number }>(
    `SELECT snapshot_date, value FROM asset_value_snapshots WHERE owner_type='PROPERTY' ORDER BY id`,
  );
}

describe("properties-store — estimate edits write today's value snapshot (Wave 2 §4)", () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
    useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('create does NOT write a snapshot (new entities keep est. semantics)', async () => {
    await usePropertiesStore.getState().create(baseProperty);
    expect(await snapshotRows(db)).toHaveLength(0);
  });

  it('updating the estimate upserts a snapshot dated today', async () => {
    const id = await usePropertiesStore.getState().create(baseProperty);
    await usePropertiesStore.getState().update(id, { currentEstimatedValue: 425_000 });
    const rows = await snapshotRows(db);
    expect(rows).toEqual([{ snapshot_date: todayIso, value: 425_000 }]);
    // Live surfaces read the asset store — it must reflect the row too.
    expect(
      useAssetValueSnapshotsStore.getState().assetValueSnapshots
        .find((s) => s.ownerType === 'PROPERTY' && s.ownerId === id && s.snapshotDate === todayIso)?.value,
    ).toBe(425_000);
  });

  it('a second same-day edit updates the SAME row (no duplicates)', async () => {
    const id = await usePropertiesStore.getState().create(baseProperty);
    await usePropertiesStore.getState().update(id, { currentEstimatedValue: 425_000 });
    await usePropertiesStore.getState().update(id, { currentEstimatedValue: 430_000 });
    const rows = await snapshotRows(db);
    expect(rows).toEqual([{ snapshot_date: todayIso, value: 430_000 }]);
  });

  it('an unchanged estimate in a full-form save does NOT write a snapshot', async () => {
    const id = await usePropertiesStore.getState().create(baseProperty);
    // Tabs submit the whole form — the estimate rides along unchanged.
    await usePropertiesStore.getState().update(id, { name: 'Home sweet home', currentEstimatedValue: 400_000 });
    expect(await snapshotRows(db)).toHaveLength(0);
  });

  it('a patch without the estimate, or clearing it to null, does NOT write a snapshot', async () => {
    const id = await usePropertiesStore.getState().create(baseProperty);
    await usePropertiesStore.getState().update(id, { name: 'Renamed' });
    await usePropertiesStore.getState().update(id, { currentEstimatedValue: null });
    expect(await snapshotRows(db)).toHaveLength(0);
  });
});
