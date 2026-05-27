import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { AccountsRepo } from '@/domain/accounts';
import { ContributionsRepo } from '@/domain/contributions';
import { commitContributionImport } from '@/lib/import/commit/contribution';
import type { ContributionResolved } from '@/lib/import/validators/contribution';
import type { PreviewRow } from '@/lib/import/types';
import { AccountType, ContributionSource } from '@/types/enums';

function makeRow(
  rowId: number,
  status: PreviewRow['status'],
  resolved: ContributionResolved,
): PreviewRow<ContributionResolved> {
  return { rowId, raw: {}, resolved, status, errors: [] };
}

describe('commitContributionImport', () => {
  let db: SqliteAdapter;
  let accountsRepo: AccountsRepo;
  let contribsRepo: ContributionsRepo;
  let accountId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    accountsRepo = new AccountsRepo(db);
    contribsRepo = new ContributionsRepo(db);
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

  it('inserts new contributions', async () => {
    const res = await commitContributionImport(
      [
        makeRow(0, 'new', {
          accountId,
          personId: null,
          date: '2026-01-15',
          amount: 500,
          source: ContributionSource.MANUAL,
        }),
        makeRow(1, 'new', {
          accountId,
          personId: null,
          date: '2026-02-15',
          amount: 500,
          source: ContributionSource.MANUAL,
        }),
      ],
      { db, contributions: contribsRepo },
    );
    expect(res.inserted).toBe(2);
    const all = await contribsRepo.listAll();
    expect(all).toHaveLength(2);
  });

  it('skips error rows', async () => {
    const res = await commitContributionImport(
      [
        makeRow(0, 'error', {
          accountId,
          personId: null,
          date: '2026-01-15',
          amount: 500,
          source: ContributionSource.MANUAL,
        }),
      ],
      { db, contributions: contribsRepo },
    );
    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(1);
  });
});
