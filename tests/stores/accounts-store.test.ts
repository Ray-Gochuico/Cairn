import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { AccountType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const sampleAccount = {
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
};

describe('useAccountsStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('initial state is empty with no loading and no error', () => {
    const { accounts, isLoading, error } = useAccountsStore.getState();
    expect(accounts).toEqual([]);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('load() populates accounts from the database', async () => {
    // Seed directly via DB so we don't depend on the store's create path
    await db.execute(
      `INSERT INTO accounts (
        household_id, owner_person_id, beneficiary_dependent_id, name, institution,
        type, crypto_wallet_address, auto_fetch_enabled, excluded_from_net_worth, state_of_plan
      ) VALUES (1, NULL, NULL, 'Seeded', 'Vanguard', 'ACCOUNT_BROKERAGE', NULL, 0, 0, NULL)`
    );

    await useAccountsStore.getState().load();
    const { accounts, isLoading, error } = useAccountsStore.getState();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Seeded');
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('create() persists the account and refreshes the in-memory cache', async () => {
    const id = await useAccountsStore.getState().create(sampleAccount);
    expect(id).toBeGreaterThan(0);

    const { accounts } = useAccountsStore.getState();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe(id);
    expect(accounts[0].name).toBe('Brokerage');
    expect(accounts[0].type).toBe(AccountType.ACCOUNT_BROKERAGE);
    expect(accounts[0].autoFetchEnabled).toBe(true);
  });

  it('update() mutates persisted fields and refreshes', async () => {
    const id = await useAccountsStore.getState().create(sampleAccount);

    await useAccountsStore.getState().update(id, {
      name: 'Taxable Brokerage',
      excludedFromNetWorth: true,
    });

    const { accounts } = useAccountsStore.getState();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Taxable Brokerage');
    expect(accounts[0].excludedFromNetWorth).toBe(true);
    expect(accounts[0].institution).toBe('Vanguard');     // unchanged
  });

  it('remove() deletes the account and refreshes', async () => {
    const id = await useAccountsStore.getState().create(sampleAccount);
    expect(useAccountsStore.getState().accounts).toHaveLength(1);

    await useAccountsStore.getState().remove(id);
    expect(useAccountsStore.getState().accounts).toEqual([]);
  });

  it('load() swallows DB errors into state.error (does NOT rethrow)', async () => {
    // Close the underlying DB so subsequent operations fail
    await db.close();

    // load() must not rethrow — it should set error on state
    await expect(useAccountsStore.getState().load()).resolves.toBeUndefined();

    const { error, isLoading } = useAccountsStore.getState();
    expect(error).not.toBeNull();
    expect(isLoading).toBe(false);
  });

  it('create() rethrows on validation failure', async () => {
    await expect(
      useAccountsStore.getState().create({
        ...sampleAccount,
        // @ts-expect-error testing runtime validation
        type: 'NOT_A_REAL_TYPE',
      })
    ).rejects.toThrow();
  });
});
