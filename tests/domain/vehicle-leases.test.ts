import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { VehicleLeasesRepo } from '@/domain/vehicle-leases';

const loadInitial = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadRentLease = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0036_add_rent_lease_tracking.sql'),
    'utf-8',
  );

describe('VehicleLeasesRepo', () => {
  let db: SqliteAdapter;
  let repo: VehicleLeasesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitial() },
      { version: '0036_add_rent_lease_tracking', sql: loadRentLease() },
    ]);
    repo = new VehicleLeasesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty list initially', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates and round-trips a lease with end date', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Tesla Model 3 lease',
      monthlyAmount: 599,
      startDate: '2026-03-01',
      endDate: '2029-02-28',
    });
    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].monthlyAmount).toBe(599);
    expect(rows[0].endDate).toBe('2029-02-28');
  });

  it('updates and deletes a lease', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Tesla',
      monthlyAmount: 599,
      startDate: '2026-03-01',
      endDate: '2029-02-28',
    });
    await repo.update(id, { monthlyAmount: 625 });
    expect((await repo.findById(id))?.monthlyAmount).toBe(625);
    await repo.delete(id);
    expect(await repo.list()).toEqual([]);
  });
});
