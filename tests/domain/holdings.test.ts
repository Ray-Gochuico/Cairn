import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadAccountMarginMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0007_add_account_margin.sql'), 'utf-8');
const loadAccentColorsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0015_add_accent_colors.sql'), 'utf-8');

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
      accentColor: null,
  });
};

describe('HoldingsRepo', () => {
  let db: SqliteAdapter;
  let repo: HoldingsRepo;
  let accountsRepo: AccountsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
    ]);
    repo = new HoldingsRepo(db);
    accountsRepo = new AccountsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty array for an account with no holdings', async () => {
    const accountId = await makeAccount(accountsRepo);
    expect(await repo.listForAccount(accountId)).toEqual([]);
  });

  it('listAll returns empty when no holdings anywhere', async () => {
    expect(await repo.listAll()).toEqual([]);
  });

  it('creates a holding with FK to an existing account', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.create({
      accountId,
      ticker: 'VTI',
      shareCount: 12.5,
      targetAllocationPct: 0.6,
      costBasis: 2400,
    });
    expect(id).toBeGreaterThan(0);

    const all = await repo.listForAccount(accountId);
    expect(all).toHaveLength(1);
    expect(all[0].ticker).toBe('VTI');
    expect(all[0].shareCount).toBe(12.5);
    expect(all[0].targetAllocationPct).toBe(0.6);
    expect(all[0].costBasis).toBe(2400);
  });

  it('accepts null target_allocation_pct and cost_basis', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.create({
      accountId,
      ticker: 'AAPL',
      shareCount: 5,
      targetAllocationPct: null,
      costBasis: null,
    });

    const found = await repo.findById(id);
    expect(found?.targetAllocationPct).toBeNull();
    expect(found?.costBasis).toBeNull();
  });

  it('listForAccount filters by accountId', async () => {
    const a1 = await makeAccount(accountsRepo, 'A1');
    const a2 = await makeAccount(accountsRepo, 'A2');

    await repo.create({ accountId: a1, ticker: 'VTI', shareCount: 1, targetAllocationPct: null, costBasis: null });
    await repo.create({ accountId: a1, ticker: 'BND', shareCount: 2, targetAllocationPct: null, costBasis: null });
    await repo.create({ accountId: a2, ticker: 'VXUS', shareCount: 3, targetAllocationPct: null, costBasis: null });

    const a1Holdings = await repo.listForAccount(a1);
    expect(a1Holdings).toHaveLength(2);
    expect(a1Holdings.map((h) => h.ticker).sort()).toEqual(['BND', 'VTI']);

    const a2Holdings = await repo.listForAccount(a2);
    expect(a2Holdings).toHaveLength(1);
    expect(a2Holdings[0].ticker).toBe('VXUS');
  });

  it('listAll returns holdings across multiple accounts', async () => {
    const a1 = await makeAccount(accountsRepo, 'A1');
    const a2 = await makeAccount(accountsRepo, 'A2');

    await repo.create({ accountId: a1, ticker: 'VTI', shareCount: 1, targetAllocationPct: null, costBasis: null });
    await repo.create({ accountId: a2, ticker: 'VXUS', shareCount: 3, targetAllocationPct: null, costBasis: null });

    const all = await repo.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((h) => h.ticker).sort()).toEqual(['VTI', 'VXUS']);
  });

  it('updates share_count and other fields via merge', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.create({
      accountId,
      ticker: 'VTI',
      shareCount: 10,
      targetAllocationPct: 0.6,
      costBasis: 1000,
    });

    await repo.update(id, { shareCount: 15 });

    const updated = await repo.findById(id);
    expect(updated?.shareCount).toBe(15);
    expect(updated?.ticker).toBe('VTI');         // unchanged
    expect(updated?.targetAllocationPct).toBe(0.6); // unchanged
    expect(updated?.costBasis).toBe(1000);        // unchanged
  });

  it('deletes a holding', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.create({
      accountId,
      ticker: 'BND',
      shareCount: 4,
      targetAllocationPct: null,
      costBasis: null,
    });
    await repo.delete(id);
    expect(await repo.listForAccount(accountId)).toEqual([]);
  });

  it('returns null from findById for unknown id', async () => {
    expect(await repo.findById(999)).toBeNull();
  });

  it('enforces FK to accounts (rejects holding with non-existent account_id)', async () => {
    // SqliteAdapter enables PRAGMA foreign_keys = ON in its constructor.
    await expect(
      repo.create({
        accountId: 9999,
        ticker: 'VTI',
        shareCount: 1,
        targetAllocationPct: null,
        costBasis: null,
      })
    ).rejects.toThrow();
  });
});
