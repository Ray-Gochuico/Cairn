import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { ContributionsRepo } from '@/domain/contributions';
import { AccountsRepo } from '@/domain/accounts';
import { PersonsRepo } from '@/domain/persons';
import { AccountType, ContributionSource } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');
const loadAccountMarginMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0007_add_account_margin.sql'), 'utf-8');

const makePerson = async (personsRepo: PersonsRepo, name: string): Promise<number> => {
  return personsRepo.create({
    householdId: 1,
    name,
    dateOfBirth: '1985-01-01',
    targetRetirementAge: 60,
    annualSalaryPretax: 100000,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
  });
};

const makeAccount = async (accountsRepo: AccountsRepo, name = 'Brokerage'): Promise<number> => {
  return accountsRepo.create({
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name,
    institution: 'Vanguard',
    type: AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: null,
  });
};

describe('ContributionsRepo', () => {
  let db: SqliteAdapter;
  let repo: ContributionsRepo;
  let accountsRepo: AccountsRepo;
  let personsRepo: PersonsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
    ]);
    repo = new ContributionsRepo(db);
    accountsRepo = new AccountsRepo(db);
    personsRepo = new PersonsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('listForAccount returns empty when no contributions', async () => {
    const accountId = await makeAccount(accountsRepo);
    expect(await repo.listForAccount(accountId)).toEqual([]);
  });

  it('creates a contribution and round-trips', async () => {
    const accountId = await makeAccount(accountsRepo);
    const personId = await makePerson(personsRepo, 'Alex');

    const id = await repo.create({
      accountId,
      personId,
      date: '2024-03-15',
      amount: 500,
      source: ContributionSource.PAYCHECK,
    });
    expect(id).toBeGreaterThan(0);

    const all = await repo.listForAccount(accountId);
    expect(all).toHaveLength(1);
    expect(all[0].amount).toBe(500);
    expect(all[0].source).toBe(ContributionSource.PAYCHECK);
    expect(all[0].date).toBe('2024-03-15');
    expect(all[0].personId).toBe(personId);
  });

  it('accepts null personId (joint / unattributed contributions)', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.create({
      accountId,
      personId: null,
      date: '2024-03-15',
      amount: 100,
      source: ContributionSource.MANUAL,
    });
    const found = await repo.findById(id);
    expect(found?.personId).toBeNull();
  });

  it('findById returns null for unknown id', async () => {
    expect(await repo.findById(999)).toBeNull();
  });

  it('listForAccount filters by accountId', async () => {
    const a1 = await makeAccount(accountsRepo, 'A1');
    const a2 = await makeAccount(accountsRepo, 'A2');

    await repo.create({ accountId: a1, personId: null, date: '2024-01-15', amount: 100, source: ContributionSource.MANUAL });
    await repo.create({ accountId: a1, personId: null, date: '2024-02-15', amount: 200, source: ContributionSource.MANUAL });
    await repo.create({ accountId: a2, personId: null, date: '2024-01-15', amount: 999, source: ContributionSource.MANUAL });

    const a1List = await repo.listForAccount(a1);
    expect(a1List).toHaveLength(2);
    expect(a1List.map((c) => c.amount).sort((x, y) => x - y)).toEqual([100, 200]);

    const a2List = await repo.listForAccount(a2);
    expect(a2List).toHaveLength(1);
    expect(a2List[0].amount).toBe(999);
  });

  it('listForPersonInMonthRange returns contributions within the inclusive month range', async () => {
    const accountId = await makeAccount(accountsRepo);
    const personId = await makePerson(personsRepo, 'Alex');

    await repo.create({ accountId, personId, date: '2024-01-15', amount: 100, source: ContributionSource.PAYCHECK });
    await repo.create({ accountId, personId, date: '2024-02-15', amount: 200, source: ContributionSource.PAYCHECK });
    await repo.create({ accountId, personId, date: '2024-03-15', amount: 300, source: ContributionSource.PAYCHECK });

    const result = await repo.listForPersonInMonthRange(personId, '2024-01', '2024-03');
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.amount).sort((x, y) => x - y)).toEqual([100, 200, 300]);
  });

  it('listForPersonInMonthRange excludes before-from and after-to months', async () => {
    const accountId = await makeAccount(accountsRepo);
    const personId = await makePerson(personsRepo, 'Alex');

    await repo.create({ accountId, personId, date: '2023-12-31', amount: 50,  source: ContributionSource.MANUAL });
    await repo.create({ accountId, personId, date: '2024-01-01', amount: 100, source: ContributionSource.MANUAL });
    await repo.create({ accountId, personId, date: '2024-02-15', amount: 200, source: ContributionSource.MANUAL });
    await repo.create({ accountId, personId, date: '2024-03-31', amount: 300, source: ContributionSource.MANUAL });
    await repo.create({ accountId, personId, date: '2024-04-01', amount: 400, source: ContributionSource.MANUAL });

    const result = await repo.listForPersonInMonthRange(personId, '2024-01', '2024-03');
    expect(result.map((c) => c.amount).sort((x, y) => x - y)).toEqual([100, 200, 300]);
  });

  it('listForPersonInMonthRange handles month-boundary last day correctly (Feb leap year)', async () => {
    const accountId = await makeAccount(accountsRepo);
    const personId = await makePerson(personsRepo, 'Alex');

    await repo.create({ accountId, personId, date: '2024-02-29', amount: 555, source: ContributionSource.MANUAL });
    await repo.create({ accountId, personId, date: '2024-03-01', amount: 777, source: ContributionSource.MANUAL });

    const result = await repo.listForPersonInMonthRange(personId, '2024-02', '2024-02');
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(555);
  });

  it('listForPersonInMonthRange filters by personId (other person excluded)', async () => {
    const accountId = await makeAccount(accountsRepo);
    const alice = await makePerson(personsRepo, 'Alice');
    const bob = await makePerson(personsRepo, 'Bob');

    await repo.create({ accountId, personId: alice, date: '2024-01-15', amount: 100, source: ContributionSource.PAYCHECK });
    await repo.create({ accountId, personId: bob,   date: '2024-01-15', amount: 200, source: ContributionSource.PAYCHECK });

    const aliceResult = await repo.listForPersonInMonthRange(alice, '2024-01', '2024-12');
    expect(aliceResult).toHaveLength(1);
    expect(aliceResult[0].amount).toBe(100);
  });

  it('listForPersonInMonthRange returns empty for no matches', async () => {
    expect(await repo.listForPersonInMonthRange(42, '2024-01', '2024-12')).toEqual([]);
  });

  it('updates a contribution via merge', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.create({
      accountId,
      personId: null,
      date: '2024-03-15',
      amount: 500,
      source: ContributionSource.PAYCHECK,
    });

    await repo.update(id, { amount: 750, source: ContributionSource.BONUS });

    const updated = await repo.findById(id);
    expect(updated?.amount).toBe(750);
    expect(updated?.source).toBe(ContributionSource.BONUS);
    expect(updated?.date).toBe('2024-03-15'); // unchanged
  });

  it('deletes a contribution', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.create({
      accountId,
      personId: null,
      date: '2024-03-15',
      amount: 500,
      source: ContributionSource.MANUAL,
    });
    await repo.delete(id);
    expect(await repo.listForAccount(accountId)).toEqual([]);
  });
});
