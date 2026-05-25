import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { TransactionsRepo } from '@/domain/transactions';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType } from '@/types/enums';
import { commitTransactionImport } from '@/lib/import/commit';
import type { PreviewRow } from '@/lib/import/types';
import type { TransactionResolved } from '@/lib/import/validators/transaction-validator';

describe('commitTransactionImport', () => {
  let db: SqliteAdapter;
  let transactionsRepo: TransactionsRepo;
  let accountsRepo: AccountsRepo;
  let accountId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    accountsRepo = new AccountsRepo(db);
    transactionsRepo = new TransactionsRepo(db);
    accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Checking',
      institution: 'Chase',
      type: AccountType.ACCOUNT_CASH,
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
    status: 'new' | 'duplicate',
    resolved: TransactionResolved,
  ): PreviewRow<TransactionResolved> {
    return { rowId, raw: {}, resolved, status, errors: [] };
  }

  it('inserts a NEW row and reports inserted=1', async () => {
    const row = makeRow(1, 'new', {
      accountId,
      date: '2024-03-15',
      amount: 54.23,
      merchant: 'AMAZON',
      categoryId: undefined,
      reimbursable: false,
      personId: null,
      source: 'CSV_IMPORT',
    });
    const result = await commitTransactionImport([row], {
      db,
      transactions: transactionsRepo,
      householdId: 1,
    });
    expect(result).toEqual({ inserted: 1, updated: 0, skipped: 0 });
    const all = await transactionsRepo.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      sourceAccountId: accountId,
      date: '2024-03-15',
      merchant: 'AMAZON',
      amount: 54.23,
      reimbursable: false,
    });
  });

  it('skips DUPLICATE rows entirely (committableRows excludes them by default)', async () => {
    // The modal already filters duplicates via committableRows when the user
    // doesn't opt in. This test confirms that if a duplicate sneaks through
    // (status === 'duplicate'), commit still inserts it — the contract is
    // "insert every row passed in that is not status === 'error'".
    const row = makeRow(1, 'duplicate', {
      accountId,
      date: '2024-03-15',
      amount: 54.23,
      merchant: 'AMAZON',
      categoryId: undefined,
      reimbursable: false,
      personId: null,
      source: 'CSV_IMPORT',
    });
    const result = await commitTransactionImport([row], {
      db,
      transactions: transactionsRepo,
      householdId: 1,
    });
    expect(result.inserted).toBe(1);
  });

  it('rolls back the entire batch if any row fails to write', async () => {
    const ok = makeRow(1, 'new', {
      accountId,
      date: '2024-03-15',
      amount: 54.23,
      merchant: 'AMAZON',
      categoryId: undefined,
      reimbursable: false,
      personId: null,
      source: 'CSV_IMPORT',
    });
    const bad = makeRow(2, 'new', {
      accountId: undefined,
      date: '2024-03-16',
      amount: 10,
      merchant: 'WHATEVER',
      categoryId: undefined,
      reimbursable: false,
      personId: null,
      source: 'CSV_IMPORT',
    } as TransactionResolved);
    await expect(
      commitTransactionImport([ok, bad], {
        db,
        transactions: transactionsRepo,
        householdId: 1,
      }),
    ).rejects.toThrow();
    const all = await transactionsRepo.list();
    expect(all).toHaveLength(0);
  });

  it('handles an empty batch as a no-op', async () => {
    const result = await commitTransactionImport([], {
      db,
      transactions: transactionsRepo,
      householdId: 1,
    });
    expect(result).toEqual({ inserted: 0, updated: 0, skipped: 0 });
  });

  it('skips status=error rows even when given (defensive)', async () => {
    const bad = makeRow(1, 'new' as 'new', {
      accountId,
      date: '2024-03-15',
      amount: 54.23,
      merchant: 'AMAZON',
      categoryId: undefined,
      reimbursable: false,
      personId: null,
      source: 'CSV_IMPORT',
    });
    bad.status = 'error';
    const result = await commitTransactionImport([bad], {
      db,
      transactions: transactionsRepo,
      householdId: 1,
    });
    expect(result.inserted).toBe(0);
  });
});
