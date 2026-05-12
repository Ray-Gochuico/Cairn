import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType, SnapshotSource } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

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

describe('AccountSnapshotsRepo', () => {
  let db: SqliteAdapter;
  let repo: AccountSnapshotsRepo;
  let accountsRepo: AccountsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    repo = new AccountSnapshotsRepo(db);
    accountsRepo = new AccountsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('listForAccount returns empty for fresh account', async () => {
    const accountId = await makeAccount(accountsRepo);
    expect(await repo.listForAccount(accountId)).toEqual([]);
  });

  it('listLatestPerAccount returns empty array with no snapshots', async () => {
    expect(await repo.listLatestPerAccount()).toEqual([]);
  });

  it('listForMonth returns empty array when no snapshots in month', async () => {
    expect(await repo.listForMonth('2024-05')).toEqual([]);
  });

  it('upsert inserts a new snapshot when none exists for (account, date)', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.upsert({
      accountId,
      snapshotDate: '2024-05-31',
      totalValue: 100000,
      source: SnapshotSource.AUTO_DERIVED,
    });
    expect(id).toBeGreaterThan(0);

    const all = await repo.listForAccount(accountId);
    expect(all).toHaveLength(1);
    expect(all[0].totalValue).toBe(100000);
    expect(all[0].source).toBe(SnapshotSource.AUTO_DERIVED);
    expect(all[0].snapshotDate).toBe('2024-05-31');
  });

  it('upsert updates existing snapshot total_value but preserves id', async () => {
    const accountId = await makeAccount(accountsRepo);
    const insertedId = await repo.upsert({
      accountId,
      snapshotDate: '2024-05-31',
      totalValue: 100000,
      source: SnapshotSource.AUTO_DERIVED,
    });

    const updatedId = await repo.upsert({
      accountId,
      snapshotDate: '2024-05-31',
      totalValue: 105000,
      source: SnapshotSource.USER_CONFIRMED,
    });

    // id preserved (because DO UPDATE doesn't allocate a new row)
    expect(updatedId).toBe(insertedId);

    const all = await repo.listForAccount(accountId);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(insertedId);
    expect(all[0].totalValue).toBe(105000);
    expect(all[0].source).toBe(SnapshotSource.USER_CONFIRMED);
  });

  it('listLatestPerAccount returns most recent snapshot per account', async () => {
    const a1 = await makeAccount(accountsRepo, 'A1');
    const a2 = await makeAccount(accountsRepo, 'A2');

    // Two months per account
    await repo.upsert({ accountId: a1, snapshotDate: '2024-04-30', totalValue: 100, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId: a1, snapshotDate: '2024-05-31', totalValue: 110, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId: a2, snapshotDate: '2024-04-30', totalValue: 200, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId: a2, snapshotDate: '2024-05-31', totalValue: 220, source: SnapshotSource.AUTO_DERIVED });

    const latest = await repo.listLatestPerAccount();
    expect(latest).toHaveLength(2);
    const byAccount = new Map(latest.map((s) => [s.accountId, s]));
    expect(byAccount.get(a1)?.totalValue).toBe(110);
    expect(byAccount.get(a1)?.snapshotDate).toBe('2024-05-31');
    expect(byAccount.get(a2)?.totalValue).toBe(220);
    expect(byAccount.get(a2)?.snapshotDate).toBe('2024-05-31');
  });

  it('listForMonth filters to the YYYY-MM month range inclusive', async () => {
    const a1 = await makeAccount(accountsRepo, 'A1');
    const a2 = await makeAccount(accountsRepo, 'A2');

    await repo.upsert({ accountId: a1, snapshotDate: '2024-04-30', totalValue: 100, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId: a1, snapshotDate: '2024-05-01', totalValue: 110, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId: a1, snapshotDate: '2024-05-31', totalValue: 120, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId: a1, snapshotDate: '2024-06-01', totalValue: 130, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId: a2, snapshotDate: '2024-05-15', totalValue: 200, source: SnapshotSource.AUTO_DERIVED });

    const may = await repo.listForMonth('2024-05');
    expect(may).toHaveLength(3);
    expect(may.map((s) => s.totalValue).sort((x, y) => x - y)).toEqual([110, 120, 200]);
  });

  it('listForAccount returns rows sorted by snapshot_date ascending', async () => {
    const accountId = await makeAccount(accountsRepo);
    await repo.upsert({ accountId, snapshotDate: '2024-06-28', totalValue: 3, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId, snapshotDate: '2024-04-30', totalValue: 1, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId, snapshotDate: '2024-05-31', totalValue: 2, source: SnapshotSource.AUTO_DERIVED });

    const all = await repo.listForAccount(accountId);
    expect(all.map((s) => s.totalValue)).toEqual([1, 2, 3]);
  });

  it('findById returns the snapshot, or null if missing', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.upsert({
      accountId,
      snapshotDate: '2024-05-31',
      totalValue: 100,
      source: SnapshotSource.MANUAL,
    });
    expect((await repo.findById(id))?.totalValue).toBe(100);
    expect(await repo.findById(999)).toBeNull();
  });

  it('deletes a snapshot by id', async () => {
    const accountId = await makeAccount(accountsRepo);
    const id = await repo.upsert({
      accountId,
      snapshotDate: '2024-05-31',
      totalValue: 100,
      source: SnapshotSource.MANUAL,
    });
    await repo.delete(id);
    expect(await repo.listForAccount(accountId)).toEqual([]);
  });
});
