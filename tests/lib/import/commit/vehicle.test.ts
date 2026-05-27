import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { VehiclesRepo } from '@/domain/vehicles';
import { commitVehicleImport } from '@/lib/import/commit/vehicle';
import type { VehicleResolved } from '@/lib/import/validators/vehicle';
import type { PreviewRow } from '@/lib/import/types';

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

  it('inserts new vehicles', async () => {
    const res = await commitVehicleImport(
      [makeRow(0, 'new', baseResolved('Daily')), makeRow(1, 'new', baseResolved('Weekend'))],
      { db, vehicles: repo, householdId: 1 },
    );
    expect(res.inserted).toBe(2);
  });

  it('updates an existing vehicle on status=update', async () => {
    const id = await repo.create(baseResolved('Daily'));
    const next = baseResolved('Daily');
    next.currentEstimatedValue = 12000;
    const res = await commitVehicleImport(
      [makeRow(0, 'update', next, id)],
      { db, vehicles: repo, householdId: 1 },
    );
    expect(res.updated).toBe(1);
    const found = await repo.findById(id);
    expect(found?.currentEstimatedValue).toBe(12000);
  });
});
