import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { VehiclesRepo } from '@/domain/vehicles';
import { LoansRepo } from '@/domain/loans';
import { LoanType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

describe('VehiclesRepo', () => {
  let db: SqliteAdapter;
  let repo: VehiclesRepo;
  let loansRepo: LoansRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    repo = new VehiclesRepo(db);
    loansRepo = new LoansRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty array when no vehicles exist', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates a vehicle and round-trips through list', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Daily Driver',
      year: 2022,
      make: 'Honda',
      model: 'Civic',
      purchaseDate: '2022-04-10',
      purchasePrice: 28000,
      currentEstimatedValue: 22000,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    expect(id).toBeGreaterThan(0);

    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Daily Driver');
    expect(all[0].year).toBe(2022);
    expect(all[0].make).toBe('Honda');
    expect(all[0].model).toBe('Civic');
    expect(all[0].purchaseDate).toBe('2022-04-10');
    expect(all[0].purchasePrice).toBe(28000);
    expect(all[0].currentEstimatedValue).toBe(22000);
    expect(all[0].excludedFromNetWorth).toBe(false);
    expect(all[0].ownerPersonId).toBeNull();
    expect(all[0].linkedLoanId).toBeNull();
  });

  it('accepts null for all nullable fields', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Project Car',
      year: null,
      make: null,
      model: null,
      purchaseDate: null,
      purchasePrice: null,
      currentEstimatedValue: null,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });

    const found = await repo.findById(id);
    expect(found?.year).toBeNull();
    expect(found?.make).toBeNull();
    expect(found?.model).toBeNull();
    expect(found?.purchaseDate).toBeNull();
    expect(found?.purchasePrice).toBeNull();
    expect(found?.currentEstimatedValue).toBeNull();
    expect(found?.linkedLoanId).toBeNull();
  });

  it('finds a vehicle by id', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Truck',
      year: 2020,
      make: 'Ford',
      model: 'F-150',
      purchaseDate: null,
      purchasePrice: null,
      currentEstimatedValue: 35000,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Truck');
    expect(found?.make).toBe('Ford');
  });

  it('returns null from findById for unknown id', async () => {
    expect(await repo.findById(999)).toBeNull();
  });

  it('updates value via merge', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Daily Driver',
      year: 2022,
      make: 'Honda',
      model: 'Civic',
      purchaseDate: '2022-04-10',
      purchasePrice: 28000,
      currentEstimatedValue: 22000,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });

    await repo.update(id, { currentEstimatedValue: 20000 });

    const updated = await repo.findById(id);
    expect(updated?.currentEstimatedValue).toBe(20000);
    expect(updated?.name).toBe('Daily Driver');        // unchanged
    expect(updated?.year).toBe(2022);                  // unchanged
    expect(updated?.purchasePrice).toBe(28000);        // unchanged
  });

  it('toggles excludedFromNetWorth via merge', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Beater',
      year: 2005,
      make: 'Toyota',
      model: 'Corolla',
      purchaseDate: null,
      purchasePrice: null,
      currentEstimatedValue: 5000,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });

    await repo.update(id, { excludedFromNetWorth: true });
    expect((await repo.findById(id))?.excludedFromNetWorth).toBe(true);

    await repo.update(id, { excludedFromNetWorth: false });
    expect((await repo.findById(id))?.excludedFromNetWorth).toBe(false);
  });

  it('deletes a vehicle', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Disposable',
      year: null,
      make: null,
      model: null,
      purchaseDate: null,
      purchasePrice: null,
      currentEstimatedValue: null,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    await repo.delete(id);
    expect(await repo.list()).toEqual([]);
  });

  it('listing returns vehicles in id order', async () => {
    const a = await repo.create({
      householdId: 1, ownerPersonId: null,
      name: 'A', year: null, make: null, model: null,
      purchaseDate: null, purchasePrice: null,
      currentEstimatedValue: null, linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    const b = await repo.create({
      householdId: 1, ownerPersonId: null,
      name: 'B', year: null, make: null, model: null,
      purchaseDate: null, purchasePrice: null,
      currentEstimatedValue: null, linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    const list = await repo.list();
    expect(list.map((v) => v.id)).toEqual([a, b]);
  });

  it('linked_loan_id round-trips through create and findById', async () => {
    const loanId = await loansRepo.create({
      householdId: 1,
      obligorPersonId: null,
      name: 'Auto Loan',
      type: LoanType.AUTO,
      originalAmount: 25000,
      currentBalance: 22000,
      interestRate: 0.05,
      termMonths: 60,
      firstPaymentDate: '2023-01-01',
      monthlyPayment: 471.78,
      extraPaymentDefault: 0,
      linkedPropertyId: null,
      linkedVehicleId: null,
    });

    const vehicleId = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Daily Driver',
      year: 2022,
      make: 'Honda',
      model: 'Civic',
      purchaseDate: '2022-04-10',
      purchasePrice: 28000,
      currentEstimatedValue: 22000,
      linkedLoanId: loanId,
      excludedFromNetWorth: false,
    });

    const found = await repo.findById(vehicleId);
    expect(found?.linkedLoanId).toBe(loanId);
  });

  it('rejects negative purchasePrice', async () => {
    await expect(
      repo.create({
        householdId: 1,
        ownerPersonId: null,
        name: 'Bad price',
        year: null,
        make: null,
        model: null,
        purchaseDate: null,
        purchasePrice: -1,
        currentEstimatedValue: null,
        linkedLoanId: null,
        excludedFromNetWorth: false,
      })
    ).rejects.toThrow();
  });

  it('rejects out-of-range year', async () => {
    await expect(
      repo.create({
        householdId: 1,
        ownerPersonId: null,
        name: 'Ancient',
        year: 1800,
        make: null,
        model: null,
        purchaseDate: null,
        purchasePrice: null,
        currentEstimatedValue: null,
        linkedLoanId: null,
        excludedFromNetWorth: false,
      })
    ).rejects.toThrow();
  });
});
