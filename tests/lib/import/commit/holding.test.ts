import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { commitHoldingImport } from '@/lib/import/commit/holding';
import type { HoldingResolved } from '@/lib/import/validators/holding';
import type { PreviewRow } from '@/lib/import/types';
import { AccountType } from '@/types/enums';

function makeRow(
  rowId: number,
  status: PreviewRow['status'],
  resolved: HoldingResolved,
  existingId?: number,
): PreviewRow<HoldingResolved> {
  return { rowId, raw: {}, resolved, status, errors: [], existingId };
}

describe('commitHoldingImport', () => {
  let db: SqliteAdapter;
  let accountsRepo: AccountsRepo;
  let holdingsRepo: HoldingsRepo;
  let accountId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    accountsRepo = new AccountsRepo(db);
    holdingsRepo = new HoldingsRepo(db);
    accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage',
      institution: null,
      type: AccountType.ACCOUNT_BROKERAGE,
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
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts new holdings', async () => {
    const res = await commitHoldingImport(
      [
        makeRow(0, 'new', { accountId, ticker: 'AAPL', shareCount: 10, costBasis: 150, targetAllocationPct: null }),
        makeRow(1, 'new', { accountId, ticker: 'VTI', shareCount: 250, costBasis: 200, targetAllocationPct: null }),
      ],
      { db, holdings: holdingsRepo },
    );
    expect(res.inserted).toBe(2);
    const all = await holdingsRepo.listAll();
    expect(all.map((h) => h.ticker).sort()).toEqual(['AAPL', 'VTI']);
  });

  it('updates an existing holding on status=update', async () => {
    const id = await holdingsRepo.create({ accountId, ticker: 'AAPL', shareCount: 5, costBasis: null, targetAllocationPct: null });
    const res = await commitHoldingImport(
      [makeRow(0, 'update', { accountId, ticker: 'AAPL', shareCount: 12, costBasis: 160, targetAllocationPct: null }, id)],
      { db, holdings: holdingsRepo },
    );
    expect(res.updated).toBe(1);
    const found = await holdingsRepo.findById(id);
    expect(found?.shareCount).toBe(12);
    expect(found?.costBasis).toBe(160);
  });

  it('skips error rows', async () => {
    const res = await commitHoldingImport(
      [makeRow(0, 'error', { accountId, ticker: '', shareCount: 0, costBasis: null, targetAllocationPct: null })],
      { db, holdings: holdingsRepo },
    );
    expect(res.skipped).toBe(1);
    expect(res.inserted).toBe(0);
  });

  it('rolls back on a write failure', async () => {
    await expect(
      commitHoldingImport(
        [
          makeRow(0, 'new', { accountId, ticker: 'GOOD', shareCount: 1, costBasis: null, targetAllocationPct: null }),
          // Empty ticker fails Zod's min(1) at repo level → throws
          makeRow(1, 'new', { accountId, ticker: '', shareCount: 1, costBasis: null, targetAllocationPct: null }),
        ],
        { db, holdings: holdingsRepo },
      ),
    ).rejects.toThrow();
    const all = await holdingsRepo.listAll();
    expect(all).toHaveLength(0);
  });
});
