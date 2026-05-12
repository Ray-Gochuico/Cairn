import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { PropertiesRepo } from '@/domain/properties';
import { LoansRepo } from '@/domain/loans';
import { PropertyType, LoanType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

describe('PropertiesRepo', () => {
  let db: SqliteAdapter;
  let repo: PropertiesRepo;
  let loansRepo: LoansRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    repo = new PropertiesRepo(db);
    loansRepo = new LoansRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty array when no properties exist', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates a property and round-trips through list', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Family Home',
      type: PropertyType.PRIMARY_RESIDENCE,
      address: '123 Main St, Anytown',
      purchaseDate: '2020-03-15',
      purchasePrice: 500000,
      currentEstimatedValue: 650000,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    expect(id).toBeGreaterThan(0);

    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Family Home');
    expect(all[0].type).toBe(PropertyType.PRIMARY_RESIDENCE);
    expect(all[0].address).toBe('123 Main St, Anytown');
    expect(all[0].purchaseDate).toBe('2020-03-15');
    expect(all[0].purchasePrice).toBe(500000);
    expect(all[0].currentEstimatedValue).toBe(650000);
    expect(all[0].excludedFromNetWorth).toBe(false);
    expect(all[0].ownerPersonId).toBeNull();
    expect(all[0].linkedLoanId).toBeNull();
  });

  it('accepts null for all nullable fields', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Land Parcel',
      type: PropertyType.LAND,
      address: null,
      purchaseDate: null,
      purchasePrice: null,
      currentEstimatedValue: null,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });

    const found = await repo.findById(id);
    expect(found?.address).toBeNull();
    expect(found?.purchaseDate).toBeNull();
    expect(found?.purchasePrice).toBeNull();
    expect(found?.currentEstimatedValue).toBeNull();
    expect(found?.linkedLoanId).toBeNull();
    expect(found?.ownerPersonId).toBeNull();
  });

  it('finds a property by id', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Vacation Cabin',
      type: PropertyType.VACATION_HOME,
      address: null,
      purchaseDate: null,
      purchasePrice: null,
      currentEstimatedValue: 200000,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Vacation Cabin');
    expect(found?.type).toBe(PropertyType.VACATION_HOME);
  });

  it('returns null from findById for unknown id', async () => {
    expect(await repo.findById(999)).toBeNull();
  });

  it('updates value via merge', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Family Home',
      type: PropertyType.PRIMARY_RESIDENCE,
      address: '123 Main St',
      purchaseDate: '2020-03-15',
      purchasePrice: 500000,
      currentEstimatedValue: 650000,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });

    await repo.update(id, { currentEstimatedValue: 700000 });

    const updated = await repo.findById(id);
    expect(updated?.currentEstimatedValue).toBe(700000);
    expect(updated?.name).toBe('Family Home');                // unchanged
    expect(updated?.purchasePrice).toBe(500000);              // unchanged
    expect(updated?.address).toBe('123 Main St');             // unchanged
  });

  it('toggles excludedFromNetWorth via merge', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Rental',
      type: PropertyType.RENTAL,
      address: null,
      purchaseDate: null,
      purchasePrice: null,
      currentEstimatedValue: 300000,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });

    await repo.update(id, { excludedFromNetWorth: true });
    expect((await repo.findById(id))?.excludedFromNetWorth).toBe(true);

    await repo.update(id, { excludedFromNetWorth: false });
    expect((await repo.findById(id))?.excludedFromNetWorth).toBe(false);
  });

  it('deletes a property', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Disposable',
      type: PropertyType.RENTAL,
      address: null,
      purchaseDate: null,
      purchasePrice: null,
      currentEstimatedValue: null,
      linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    await repo.delete(id);
    expect(await repo.list()).toEqual([]);
  });

  it('listing returns properties in id order', async () => {
    const a = await repo.create({
      householdId: 1, ownerPersonId: null,
      name: 'A', type: PropertyType.PRIMARY_RESIDENCE,
      address: null, purchaseDate: null, purchasePrice: null,
      currentEstimatedValue: null, linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    const b = await repo.create({
      householdId: 1, ownerPersonId: null,
      name: 'B', type: PropertyType.RENTAL,
      address: null, purchaseDate: null, purchasePrice: null,
      currentEstimatedValue: null, linkedLoanId: null,
      excludedFromNetWorth: false,
    });
    const list = await repo.list();
    expect(list.map((p) => p.id)).toEqual([a, b]);
  });

  it('linked_loan_id round-trips through create and findById', async () => {
    const loanId = await loansRepo.create({
      householdId: 1,
      obligorPersonId: null,
      name: 'Mortgage',
      type: LoanType.MORTGAGE,
      originalAmount: 400000,
      currentBalance: 400000,
      interestRate: 0.06,
      termMonths: 360,
      firstPaymentDate: '2024-06-01',
      monthlyPayment: 2398.20,
      extraPaymentDefault: 0,
      linkedPropertyId: null,
      linkedVehicleId: null,
    });

    const propertyId = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      name: 'Family Home',
      type: PropertyType.PRIMARY_RESIDENCE,
      address: '123 Main St',
      purchaseDate: '2020-03-15',
      purchasePrice: 500000,
      currentEstimatedValue: 650000,
      linkedLoanId: loanId,
      excludedFromNetWorth: false,
    });

    const found = await repo.findById(propertyId);
    expect(found?.linkedLoanId).toBe(loanId);
  });

  it('rejects invalid type enum on create', async () => {
    await expect(
      repo.create({
        householdId: 1,
        ownerPersonId: null,
        name: 'Bogus',
        // @ts-expect-error testing runtime validation
        type: 'NOT_A_PROPERTY_TYPE',
        address: null,
        purchaseDate: null,
        purchasePrice: null,
        currentEstimatedValue: null,
        linkedLoanId: null,
        excludedFromNetWorth: false,
      })
    ).rejects.toThrow();
  });

  it('rejects negative purchasePrice', async () => {
    await expect(
      repo.create({
        householdId: 1,
        ownerPersonId: null,
        name: 'Bad price',
        type: PropertyType.PRIMARY_RESIDENCE,
        address: null,
        purchaseDate: null,
        purchasePrice: -1,
        currentEstimatedValue: null,
        linkedLoanId: null,
        excludedFromNetWorth: false,
      })
    ).rejects.toThrow();
  });
});
