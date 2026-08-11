import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType } from '@/types/enums';

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
  accentColor: null,
};

describe('useAccountsStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // Full migration chain so AccountsRepo.update() sees the 0018 roadmap
    // rule-engine columns (has_employer_match, etc.) and doesn't throw on
    // "no such column" — W7-R1.
    await runMigrations(db, await loadAllMigrations());
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

  it('createWithAnswers persists all four collected chart answers (Wave A item 2)', async () => {
    const id = await useAccountsStore.getState().createWithAnswers({
      ...sampleAccount,
      hasEmployerMatch: true,
      employerMatchPct: 0.04,        // 4% — stored as a fraction
      employerMatchLimitPct: 0.06,   // of-salary limit, fraction
      allowsMegaBackdoorRollover: true,
    });
    const saved = useAccountsStore.getState().accounts.find((a) => a.id === id)!;
    expect(saved.hasEmployerMatch).toBe(true);
    expect(saved.employerMatchPct).toBeCloseTo(0.04, 10);
    expect(saved.employerMatchLimitPct).toBeCloseTo(0.06, 10);
    expect(saved.allowsMegaBackdoorRollover).toBe(true);
    expect(saved.hasHighFees).toBeNull(); // never collected — stays null
  });

  it('createWithAnswers self-cleans: an answers-update failure removes the created row and rethrows', async () => {
    const updateSpy = vi
      .spyOn(AccountsRepo.prototype, 'update')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(
      useAccountsStore.getState().createWithAnswers({
        ...sampleAccount,
        hasEmployerMatch: true,
        employerMatchPct: null,
        employerMatchLimitPct: null,
        allowsMegaBackdoorRollover: null,
      }),
    ).rejects.toThrow('disk full');
    expect(useAccountsStore.getState().accounts).toHaveLength(0); // no stranded match-less account
    updateSpy.mockRestore();
  });
});
