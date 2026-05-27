import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';

const loadInitial = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadRentLease = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0036_add_rent_lease_tracking.sql'),
    'utf-8',
  );

describe('useHousingPaymentsStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitial() },
      { version: '0036_add_rent_lease_tracking', sql: loadRentLease() },
    ]);
    setDatabase(db);
    useHousingPaymentsStore.setState({
      housingPayments: [],
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('loads, creates, updates, and removes', async () => {
    await useHousingPaymentsStore.getState().load();
    expect(useHousingPaymentsStore.getState().housingPayments).toEqual([]);

    const id = await useHousingPaymentsStore.getState().create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Apt',
      monthlyAmount: 2400,
      startDate: '2026-01-01',
      endDate: null,
    });
    expect(useHousingPaymentsStore.getState().housingPayments).toHaveLength(1);
    expect(useHousingPaymentsStore.getState().housingPayments[0].id).toBe(id);

    await useHousingPaymentsStore.getState().update(id, { monthlyAmount: 2500 });
    expect(useHousingPaymentsStore.getState().housingPayments[0].monthlyAmount).toBe(2500);

    await useHousingPaymentsStore.getState().remove(id);
    expect(useHousingPaymentsStore.getState().housingPayments).toEqual([]);
  });
});
