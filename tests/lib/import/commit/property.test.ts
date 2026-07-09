import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { PropertiesRepo } from '@/domain/properties';
import { AssetValueSnapshotsRepo } from '@/domain/asset-value-snapshots';
import { commitPropertyImport } from '@/lib/import/commit/property';
import type { PropertyResolved } from '@/lib/import/validators/property';
import type { PreviewRow } from '@/lib/import/types';
import { PropertyType } from '@/types/enums';

const TODAY_ISO = '2026-07-07'; // injected import-run date — keeps this suite clock-free

function baseResolved(name: string): PropertyResolved {
  return {
    householdId: 1,
    ownerPersonId: null,
    name,
    type: PropertyType.PRIMARY_RESIDENCE,
    address: null,
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: 500000,
    linkedLoanId: null,
    excludedFromNetWorth: false,
  };
}

function makeRow(
  rowId: number,
  status: PreviewRow['status'],
  resolved: PropertyResolved,
  existingId?: number,
): PreviewRow<PropertyResolved> {
  return { rowId, raw: {}, resolved, status, errors: [], existingId };
}

describe('commitPropertyImport', () => {
  let db: SqliteAdapter;
  let repo: PropertiesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    repo = new PropertiesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const deps = () => ({
    db,
    properties: repo,
    assetValueSnapshots: new AssetValueSnapshotsRepo(db),
    householdId: 1,
    todayIso: TODAY_ISO,
  });

  it('inserts new properties', async () => {
    const res = await commitPropertyImport(
      [makeRow(0, 'new', baseResolved('Main')), makeRow(1, 'new', baseResolved('Cabin'))],
      deps(),
    );
    expect(res.inserted).toBe(2);
  });

  it('updates an existing property on status=update', async () => {
    const id = await repo.create(baseResolved('Main'));
    const next = baseResolved('Main');
    next.currentEstimatedValue = 800000;
    const res = await commitPropertyImport(
      [makeRow(0, 'update', next, id)],
      deps(),
    );
    expect(res.updated).toBe(1);
    const found = await repo.findById(id);
    expect(found?.currentEstimatedValue).toBe(800000);
  });

  describe('estimate→snapshot seam (wave-7 W2)', () => {
    const snapshotRows = (ownerId: number) =>
      db.select<{ snapshot_date: string; value: number }>(
        `SELECT snapshot_date, value FROM asset_value_snapshots
         WHERE owner_type = 'PROPERTY' AND owner_id = ? ORDER BY id`,
        [ownerId],
      );

    it('an update row with a CHANGED value upserts a today-dated PROPERTY snapshot', async () => {
      const base = baseResolved('Main');
      base.currentEstimatedValue = 700000;
      const existingId = await repo.create(base);
      const next = baseResolved('Main');
      next.currentEstimatedValue = 800000;
      await commitPropertyImport([makeRow(0, 'update', next, existingId)], deps());
      const snaps = await snapshotRows(existingId);
      expect(snaps).toEqual([{ snapshot_date: TODAY_ISO, value: 800000 }]);
    });

    it('an update row with the SAME value writes no snapshot (store-gate parity)', async () => {
      const base = baseResolved('Main');
      base.currentEstimatedValue = 700000;
      const existingId = await repo.create(base);
      const next = baseResolved('Main');
      next.currentEstimatedValue = 700000;
      await commitPropertyImport([makeRow(0, 'update', next, existingId)], deps());
      expect(await snapshotRows(existingId)).toHaveLength(0);
    });

    it('a NEW row mints no snapshot (parity with properties-store.create)', async () => {
      const row = baseResolved('New Place');
      row.currentEstimatedValue = 650000;
      await commitPropertyImport([makeRow(0, 'new', row)], deps());
      const all = await db.select<{ n: number }>(
        `SELECT COUNT(*) AS n FROM asset_value_snapshots`,
      );
      expect(all[0].n).toBe(0);
    });

    it('re-importing another change the same day UPDATES the same-date row (no duplicates)', async () => {
      const base = baseResolved('Main');
      base.currentEstimatedValue = 700000;
      const existingId = await repo.create(base);
      const first = baseResolved('Main');
      first.currentEstimatedValue = 750000;
      await commitPropertyImport([makeRow(0, 'update', first, existingId)], deps());
      const second = baseResolved('Main');
      second.currentEstimatedValue = 775000;
      await commitPropertyImport([makeRow(0, 'update', second, existingId)], deps());
      const snaps = await snapshotRows(existingId);
      expect(snaps).toEqual([{ snapshot_date: TODAY_ISO, value: 775000 }]);
    });
  });

  it('two same-name rows resolving to one entity commit ONE update + ONE snapshot (wave-9 chip)', async () => {
    // Both rows are status='update' with the same existingId (the validator
    // has no in-file dedupe); pre-fix each minted its own UPDATE + same-date
    // upsert and `updated` counted 2 for one entity.
    const base = baseResolved('Main');
    base.currentEstimatedValue = 500000;
    const existingId = await repo.create(base);
    const first = baseResolved('Main');
    first.currentEstimatedValue = 510000;
    const second = baseResolved('Main');
    second.currentEstimatedValue = 520000; // last row wins
    const d = deps();
    const batchSpy = vi.spyOn(d.db, 'executeBatch');
    const res = await commitPropertyImport(
      [makeRow(0, 'update', first, existingId), makeRow(1, 'update', second, existingId)],
      d,
    );
    expect(res.updated).toBe(1);
    const statements = batchSpy.mock.calls[0][0];
    expect(statements.filter((st) => /UPDATE properties/i.test(st.sql))).toHaveLength(1);
    expect(statements.filter((st) => /asset_value_snapshots/i.test(st.sql))).toHaveLength(1);
    // The surviving payload is the LAST row's value.
    const found = await repo.findById(existingId);
    expect(found?.currentEstimatedValue).toBe(520000);
  });
});
