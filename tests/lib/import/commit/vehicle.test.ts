import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { VehiclesRepo } from '@/domain/vehicles';
import { AssetValueSnapshotsRepo } from '@/domain/asset-value-snapshots';
import { commitVehicleImport } from '@/lib/import/commit/vehicle';
import type { VehicleResolved } from '@/lib/import/validators/vehicle';
import type { PreviewRow } from '@/lib/import/types';

const TODAY_ISO = '2026-07-07'; // injected import-run date — keeps this suite clock-free

function baseResolved(name: string): VehicleResolved {
  return {
    householdId: 1,
    ownerPersonId: null,
    name,
    year: null,
    make: null,
    model: null,
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: 15000,
    linkedLoanId: null,
    excludedFromNetWorth: false,
  };
}

function makeRow(
  rowId: number,
  status: PreviewRow['status'],
  resolved: VehicleResolved,
  existingId?: number,
): PreviewRow<VehicleResolved> {
  return { rowId, raw: {}, resolved, status, errors: [], existingId };
}

describe('commitVehicleImport', () => {
  let db: SqliteAdapter;
  let repo: VehiclesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    repo = new VehiclesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const deps = () => ({
    db,
    vehicles: repo,
    assetValueSnapshots: new AssetValueSnapshotsRepo(db),
    householdId: 1,
    todayIso: TODAY_ISO,
  });

  it('inserts new vehicles', async () => {
    const res = await commitVehicleImport(
      [makeRow(0, 'new', baseResolved('Daily')), makeRow(1, 'new', baseResolved('Weekend'))],
      deps(),
    );
    expect(res.inserted).toBe(2);
  });

  it('updates an existing vehicle on status=update', async () => {
    const id = await repo.create(baseResolved('Daily'));
    const next = baseResolved('Daily');
    next.currentEstimatedValue = 12000;
    const res = await commitVehicleImport(
      [makeRow(0, 'update', next, id)],
      deps(),
    );
    expect(res.updated).toBe(1);
    const found = await repo.findById(id);
    expect(found?.currentEstimatedValue).toBe(12000);
  });

  describe('estimate→snapshot seam (wave-7 W2 — mirrors the property side)', () => {
    const snapshotRows = (ownerId: number) =>
      db.select<{ snapshot_date: string; value: number }>(
        `SELECT snapshot_date, value FROM asset_value_snapshots
         WHERE owner_type = 'VEHICLE' AND owner_id = ? ORDER BY id`,
        [ownerId],
      );

    it('an update row with a CHANGED value upserts a today-dated VEHICLE snapshot', async () => {
      const base = baseResolved('Daily');
      base.currentEstimatedValue = 20000;
      const existingId = await repo.create(base);
      const next = baseResolved('Daily');
      next.currentEstimatedValue = 18500;
      await commitVehicleImport([makeRow(0, 'update', next, existingId)], deps());
      const snaps = await snapshotRows(existingId);
      expect(snaps).toEqual([{ snapshot_date: TODAY_ISO, value: 18500 }]);
    });

    it('an update row with the SAME value writes no snapshot (store-gate parity)', async () => {
      const base = baseResolved('Daily');
      base.currentEstimatedValue = 20000;
      const existingId = await repo.create(base);
      const next = baseResolved('Daily');
      next.currentEstimatedValue = 20000;
      await commitVehicleImport([makeRow(0, 'update', next, existingId)], deps());
      expect(await snapshotRows(existingId)).toHaveLength(0);
    });

    it('a NEW row mints no snapshot (parity with vehicles-store.create)', async () => {
      const row = baseResolved('New Car');
      row.currentEstimatedValue = 32000;
      await commitVehicleImport([makeRow(0, 'new', row)], deps());
      const all = await db.select<{ n: number }>(
        `SELECT COUNT(*) AS n FROM asset_value_snapshots`,
      );
      expect(all[0].n).toBe(0);
    });

    it('re-importing another change the same day UPDATES the same-date row (no duplicates)', async () => {
      const base = baseResolved('Daily');
      base.currentEstimatedValue = 20000;
      const existingId = await repo.create(base);
      const first = baseResolved('Daily');
      first.currentEstimatedValue = 19000;
      await commitVehicleImport([makeRow(0, 'update', first, existingId)], deps());
      const second = baseResolved('Daily');
      second.currentEstimatedValue = 18250;
      await commitVehicleImport([makeRow(0, 'update', second, existingId)], deps());
      const snaps = await snapshotRows(existingId);
      expect(snaps).toEqual([{ snapshot_date: TODAY_ISO, value: 18250 }]);
    });
  });
});
