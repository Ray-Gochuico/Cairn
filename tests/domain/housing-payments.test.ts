import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { HousingPaymentsRepo } from '@/domain/housing-payments';

const loadInitial = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadRentLease = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0036_add_rent_lease_tracking.sql'),
    'utf-8',
  );

describe('HousingPaymentsRepo', () => {
  let db: SqliteAdapter;
  let repo: HousingPaymentsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitial() },
      { version: '0036_add_rent_lease_tracking', sql: loadRentLease() },
    ]);
    repo = new HousingPaymentsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty list initially', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates and round-trips an open-ended rental', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Brooklyn apt',
      monthlyAmount: 3200,
      startDate: '2026-01-01',
      endDate: null,
    });
    expect(id).toBeGreaterThan(0);

    const rows = await repo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Brooklyn apt');
    expect(rows[0].monthlyAmount).toBe(3200);
    expect(rows[0].startDate).toBe('2026-01-01');
    expect(rows[0].endDate).toBeNull();
    expect(rows[0].ownerPersonId).toBeNull();
  });

  it('updates an existing rental', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Brooklyn apt',
      monthlyAmount: 3200,
      startDate: '2026-01-01',
      endDate: null,
    });
    await repo.update(id, { monthlyAmount: 3350, endDate: '2027-12-31' });
    const found = await repo.findById(id);
    expect(found?.monthlyAmount).toBe(3350);
    expect(found?.endDate).toBe('2027-12-31');
  });

  it('deletes a rental', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Brooklyn apt',
      monthlyAmount: 3200,
      startDate: '2026-01-01',
      endDate: null,
    });
    await repo.delete(id);
    expect(await repo.list()).toEqual([]);
  });

  it('rejects negative monthly amount at the schema boundary', async () => {
    await expect(
      repo.create({
        householdId: 1,
        ownerPersonId: null,
        name: 'Bad',
        monthlyAmount: -10,
        startDate: '2026-01-01',
        endDate: null,
      }),
    ).rejects.toThrow();
  });
});
