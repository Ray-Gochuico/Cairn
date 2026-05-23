import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { AccountsRepo } from '@/domain/accounts';
import { PersonsRepo } from '@/domain/persons';
import { DependentsRepo } from '@/domain/dependents';
import { AccountType, DependentType } from '@/types/enums';
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
const loadAccentColorsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0015_add_accent_colors.sql'), 'utf-8');

describe('AccountsRepo', () => {
  let db: SqliteAdapter;
  let repo: AccountsRepo;
  let personsRepo: PersonsRepo;
  let dependentsRepo: DependentsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
    ]);
    repo = new AccountsRepo(db);
    personsRepo = new PersonsRepo(db);
    dependentsRepo = new DependentsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty array when no accounts exist', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates an account and round-trips through list', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Joint Brokerage',
      institution: 'Vanguard',
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: true,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
    expect(id).toBeGreaterThan(0);

    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Joint Brokerage');
    expect(all[0].institution).toBe('Vanguard');
    expect(all[0].type).toBe(AccountType.ACCOUNT_BROKERAGE);
    expect(all[0].autoFetchEnabled).toBe(true);
    expect(all[0].excludedFromNetWorth).toBe(false);
    expect(all[0].ownerPersonId).toBeNull();
    expect(all[0].beneficiaryDependentId).toBeNull();
    expect(all[0].stateOfPlan).toBeNull();
    expect(all[0].cryptoWalletAddress).toBeNull();
  });

  it('finds an account by id', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Cash',
      institution: null,
      type: AccountType.ACCOUNT_CASH,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Cash');
    expect(found?.type).toBe(AccountType.ACCOUNT_CASH);
  });

  it('returns null from findById for unknown id', async () => {
    expect(await repo.findById(999)).toBeNull();
  });

  it('updates an existing account by merging fields', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage',
      institution: 'Vanguard',
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: true,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });

    await repo.update(id, { name: 'Taxable Brokerage', excludedFromNetWorth: true });

    const updated = await repo.findById(id);
    expect(updated?.name).toBe('Taxable Brokerage');
    expect(updated?.excludedFromNetWorth).toBe(true);
    expect(updated?.institution).toBe('Vanguard'); // unchanged
    expect(updated?.autoFetchEnabled).toBe(true);  // unchanged
  });

  it('deletes an account', async () => {
    const id = await repo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Disposable',
      institution: null,
      type: AccountType.ACCOUNT_SAVINGS,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
    await repo.delete(id);
    expect(await repo.list()).toEqual([]);
  });

  it('rejects invalid type enum value on create', async () => {
    await expect(
      repo.create({
        householdId: 1,
        ownerPersonId: null,
        beneficiaryDependentId: null,
        name: 'Bogus',
        institution: null,
        // @ts-expect-error testing runtime validation
        type: 'NOT_A_REAL_TYPE',
        cryptoWalletAddress: null,
        autoFetchEnabled: false,
        excludedFromNetWorth: false,
        stateOfPlan: null,
        accentColor: null,
      })
    ).rejects.toThrow();
  });

  it('listForPerson filters by owner_person_id', async () => {
    const aliceId = await personsRepo.create({
      householdId: 1,
      name: 'Alice',
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
    const bobId = await personsRepo.create({
      householdId: 1,
      name: 'Bob',
      dateOfBirth: '1986-02-02',
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

    await repo.create({
      householdId: 1, ownerPersonId: aliceId, beneficiaryDependentId: null,
      name: "Alice's 401k", institution: 'Fidelity', type: AccountType.ACCOUNT_401K,
      cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false, stateOfPlan: null,
      accentColor: null,
    });
    await repo.create({
      householdId: 1, ownerPersonId: bobId, beneficiaryDependentId: null,
      name: "Bob's Roth", institution: 'Fidelity', type: AccountType.ACCOUNT_ROTH_IRA,
      cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false, stateOfPlan: null,
      accentColor: null,
    });
    await repo.create({
      householdId: 1, ownerPersonId: null, beneficiaryDependentId: null,
      name: 'Joint Cash', institution: null, type: AccountType.ACCOUNT_CASH,
      cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false, stateOfPlan: null,
      accentColor: null,
    });

    const alices = await repo.listForPerson(aliceId);
    expect(alices).toHaveLength(1);
    expect(alices[0].name).toBe("Alice's 401k");

    const bobs = await repo.listForPerson(bobId);
    expect(bobs).toHaveLength(1);
    expect(bobs[0].name).toBe("Bob's Roth");
  });

  it('listForPerson returns empty array when no matches', async () => {
    expect(await repo.listForPerson(42)).toEqual([]);
  });

  it('listFor529Beneficiary filters by type=ACCOUNT_529 AND beneficiary_dependent_id', async () => {
    const kidId = await dependentsRepo.create({
      householdId: 1,
      name: 'Kid',
      dateOfBirth: '2018-06-10',
      type: DependentType.CHILD,
    });
    const otherKidId = await dependentsRepo.create({
      householdId: 1,
      name: 'Other Kid',
      dateOfBirth: '2020-06-10',
      type: DependentType.CHILD,
    });

    // 529 for Kid
    await repo.create({
      householdId: 1, ownerPersonId: null, beneficiaryDependentId: kidId,
      name: "Kid's 529", institution: 'Edward Jones', type: AccountType.ACCOUNT_529,
      cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false, stateOfPlan: 'NY',
      accentColor: null,
    });
    // 529 for Other Kid
    await repo.create({
      householdId: 1, ownerPersonId: null, beneficiaryDependentId: otherKidId,
      name: "Other Kid's 529", institution: 'Edward Jones', type: AccountType.ACCOUNT_529,
      cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false, stateOfPlan: 'NY',
      accentColor: null,
    });
    // Brokerage that has Kid as beneficiary (should NOT show up — type filter)
    await repo.create({
      householdId: 1, ownerPersonId: null, beneficiaryDependentId: kidId,
      name: 'Trust Brokerage', institution: 'Fidelity', type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false, stateOfPlan: null,
      accentColor: null,
    });

    const kid529s = await repo.listFor529Beneficiary(kidId);
    expect(kid529s).toHaveLength(1);
    expect(kid529s[0].name).toBe("Kid's 529");
    expect(kid529s[0].type).toBe(AccountType.ACCOUNT_529);
    expect(kid529s[0].stateOfPlan).toBe('NY');
  });

  it('listFor529Beneficiary returns empty array when no matches', async () => {
    expect(await repo.listFor529Beneficiary(99)).toEqual([]);
  });

  describe('AccountsRepo allowMargin round-trip', () => {
    it('persists allowMargin: true and reads it back as true', async () => {
      const id = await repo.create({
        householdId: 1,
        ownerPersonId: null,
        beneficiaryDependentId: null,
        name: 'Margin Account',
        institution: null,
        type: AccountType.ACCOUNT_BROKERAGE,
        cryptoWalletAddress: null,
        autoFetchEnabled: false,
        excludedFromNetWorth: false,
        allowMargin: true,
        stateOfPlan: null,
        accentColor: null,
      });
      const account = await repo.findById(id);
      expect(account?.allowMargin).toBe(true);
    });

    it('defaults allowMargin to false when not specified at create time', async () => {
      const id = await repo.create({
        householdId: 1,
        ownerPersonId: null,
        beneficiaryDependentId: null,
        name: 'Cash Account',
        institution: null,
        type: AccountType.ACCOUNT_CASH,
        cryptoWalletAddress: null,
        autoFetchEnabled: false,
        excludedFromNetWorth: false,
        stateOfPlan: null,
        accentColor: null,
      });
      const account = await repo.findById(id);
      expect(account?.allowMargin).toBe(false);
    });

    it('updates allowMargin from false to true via update()', async () => {
      const id = await repo.create({
        householdId: 1,
        ownerPersonId: null,
        beneficiaryDependentId: null,
        name: 'Upgradeable Account',
        institution: null,
        type: AccountType.ACCOUNT_BROKERAGE,
        cryptoWalletAddress: null,
        autoFetchEnabled: false,
        excludedFromNetWorth: false,
        allowMargin: false,
        stateOfPlan: null,
        accentColor: null,
      });
      await repo.update(id, { allowMargin: true });
      const account = await repo.findById(id);
      expect(account?.allowMargin).toBe(true);
    });
  });
});
