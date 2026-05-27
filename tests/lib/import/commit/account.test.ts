import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { AccountsRepo } from '@/domain/accounts';
import { commitAccountImport } from '@/lib/import/commit/account';
import type { AccountResolved } from '@/lib/import/validators/account';
import type { PreviewRow } from '@/lib/import/types';
import { AccountType } from '@/types/enums';

function baseResolved(name: string, type: AccountType = AccountType.ACCOUNT_CASH): AccountResolved {
  return {
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name,
    institution: null,
    type,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
    accentColor: null,
    hasEmployerMatch: null,
    employerMatchPct: null,
    employerMatchLimitPct: null,
    allowsMegaBackdoorRollover: null,
    hasHighFees: null,
    apyRate: null,
  };
}

function makeRow(
  rowId: number,
  status: PreviewRow['status'],
  resolved: AccountResolved,
  existingId?: number,
): PreviewRow<AccountResolved> {
  return { rowId, raw: {}, resolved, status, errors: [], existingId };
}

describe('commitAccountImport', () => {
  let db: SqliteAdapter;
  let repo: AccountsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    repo = new AccountsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts new accounts', async () => {
    const result = await commitAccountImport(
      [
        makeRow(0, 'new', baseResolved('Chase Checking')),
        makeRow(1, 'new', baseResolved('Vanguard Brokerage', AccountType.ACCOUNT_BROKERAGE)),
      ],
      { db, accounts: repo, householdId: 1 },
    );
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    const all = await repo.list();
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.name).sort()).toEqual(['Chase Checking', 'Vanguard Brokerage']);
  });

  it('updates existing accounts when status=update', async () => {
    const id = await repo.create(baseResolved('Chase Checking'));
    const updated = baseResolved('Chase Checking');
    updated.institution = 'Chase';
    const result = await commitAccountImport(
      [makeRow(0, 'update', updated, id)],
      { db, accounts: repo, householdId: 1 },
    );
    expect(result.updated).toBe(1);
    const found = await repo.findById(id);
    expect(found?.institution).toBe('Chase');
  });

  it('skips error rows', async () => {
    const result = await commitAccountImport(
      [makeRow(0, 'error', baseResolved('X'))],
      { db, accounts: repo, householdId: 1 },
    );
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('handles an empty batch as a no-op', async () => {
    const result = await commitAccountImport([], { db, accounts: repo, householdId: 1 });
    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 0 });
  });

  it('rolls back the entire batch when a row fails to write', async () => {
    // Invalid row: name is empty (violates Zod min(1) in AccountsRepo.create).
    const bad = baseResolved('');
    await expect(
      commitAccountImport(
        [makeRow(0, 'new', baseResolved('Valid')), makeRow(1, 'new', bad)],
        { db, accounts: repo, householdId: 1 },
      ),
    ).rejects.toThrow();
    const all = await repo.list();
    expect(all).toHaveLength(0);
  });
});
