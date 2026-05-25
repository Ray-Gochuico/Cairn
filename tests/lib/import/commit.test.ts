import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType, SnapshotSource } from '@/types/enums';
import { commitSnapshotImport } from '@/lib/import/commit';
import type { PreviewRow } from '@/lib/import/types';
import type { SnapshotResolved } from '@/lib/import/validators/snapshot-validator';

describe('commitSnapshotImport', () => {
  let db: SqliteAdapter;
  let snapshotsRepo: AccountSnapshotsRepo;
  let accountsRepo: AccountsRepo;
  let accountId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    accountsRepo = new AccountsRepo(db);
    snapshotsRepo = new AccountSnapshotsRepo(db);
    accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Fidelity 401k',
      institution: 'Fidelity',
      type: AccountType.ACCOUNT_401K,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  function makeRow(
    rowId: number,
    status: 'new' | 'update',
    resolved: SnapshotResolved,
    existing?: number,
  ): PreviewRow<SnapshotResolved> {
    return { rowId, raw: {}, resolved, status, errors: [], existing };
  }

  it('inserts a NEW row and reports inserted=1', async () => {
    const row = makeRow(1, 'new', {
      accountId, snapshotDate: '2023-06-30', totalValue: 60000, source: 'CSV_IMPORT',
    });
    const result = await commitSnapshotImport([row], { db, snapshots: snapshotsRepo });
    expect(result).toEqual({ inserted: 1, updated: 0, skipped: 0 });
    const all = await snapshotsRepo.listForAccount(accountId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ snapshotDate: '2023-06-30', totalValue: 60000, source: 'CSV_IMPORT' });
  });

  it('updates an UPDATE row and reports updated=1', async () => {
    await snapshotsRepo.upsert({
      accountId, snapshotDate: '2023-06-30', totalValue: 50000, source: SnapshotSource.MANUAL,
    });
    const row = makeRow(1, 'update', {
      accountId, snapshotDate: '2023-06-30', totalValue: 60000, source: 'CSV_IMPORT',
    }, 50000);
    const result = await commitSnapshotImport([row], { db, snapshots: snapshotsRepo });
    expect(result).toEqual({ inserted: 0, updated: 1, skipped: 0 });
    const all = await snapshotsRepo.listForAccount(accountId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ totalValue: 60000, source: 'CSV_IMPORT' });
  });

  it('rolls back the entire batch if any row fails to write', async () => {
    const ok = makeRow(1, 'new', {
      accountId, snapshotDate: '2023-06-30', totalValue: 60000, source: 'CSV_IMPORT',
    });
    const bad = makeRow(2, 'new', {
      accountId: undefined, snapshotDate: '2023-07-31', totalValue: 70000, source: 'CSV_IMPORT',
    } as SnapshotResolved);
    await expect(commitSnapshotImport([ok, bad], { db, snapshots: snapshotsRepo })).rejects.toThrow();
    const all = await snapshotsRepo.listForAccount(accountId);
    expect(all).toHaveLength(0);
  });

  it('handles an empty batch as a no-op', async () => {
    const result = await commitSnapshotImport([], { db, snapshots: snapshotsRepo });
    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 0 });
  });
});
