import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { AccountType, SnapshotSource } from '@/types/enums';
import type { PriceCacheAPI } from '@/market/price-cache';
import { deriveTodaysSnapshot } from '@/market/daily-snapshot';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadAccountMarginMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0007_add_account_margin.sql'), 'utf-8');
const loadAccentColorsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0015_add_accent_colors.sql'), 'utf-8');
const loadAppSettingsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0014_add_app_settings.sql'), 'utf-8');
const loadCashApyMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0024_cash_apy.sql'), 'utf-8');

describe('deriveTodaysSnapshot', () => {
  let db: SqliteAdapter;
  let accounts: AccountsRepo;
  let holdings: HoldingsRepo;
  let snapshots: AccountSnapshotsRepo;
  let prices: PriceCacheAPI;
  let currentFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
      { version: '0014_add_app_settings', sql: loadAppSettingsMigration() },
      { version: '0024_cash_apy', sql: loadCashApyMigration() },
    ]);
    accounts = new AccountsRepo(db);
    holdings = new HoldingsRepo(db);
    snapshots = new AccountSnapshotsRepo(db);

    currentFn = vi.fn(async (ticker: string) => {
      if (ticker === 'VTI') return 250;
      if (ticker === 'AAPL') return 200;
      return 100;
    });
    prices = {
      historicalPrice: vi.fn(),
      currentPrice: currentFn,
    };
  });

  afterEach(async () => {
    await db.close();
  });

  async function makeAccount(name: string, type: AccountType): Promise<number> {
    return accounts.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name,
      institution: null,
      type,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
  }

  it('upserts a snapshot per account that has at least one holding', async () => {
    const acct1 = await makeAccount('Brokerage', AccountType.ACCOUNT_BROKERAGE);
    const acct2 = await makeAccount('Roth', AccountType.ACCOUNT_ROTH_IRA);
    const acct3 = await makeAccount('Empty 401k', AccountType.ACCOUNT_401K);

    await holdings.create({
      accountId: acct1,
      ticker: 'VTI',
      shareCount: 10,
      targetAllocationPct: null,
      costBasis: null,
    });
    await holdings.create({
      accountId: acct2,
      ticker: 'AAPL',
      shareCount: 5,
      targetAllocationPct: null,
      costBasis: null,
    });

    const result = await deriveTodaysSnapshot({ accounts, holdings, snapshots, prices });

    expect(result.upserted).toEqual(expect.arrayContaining([acct1, acct2]));
    expect(result.upserted).not.toContain(acct3);
    expect(result.skipped).toContain(acct3);

    const acct1Snaps = await snapshots.listForAccount(acct1);
    expect(acct1Snaps).toHaveLength(1);
    expect(acct1Snaps[0].totalValue).toBe(10 * 250); // 2500
    expect(acct1Snaps[0].source).toBe(SnapshotSource.AUTO_DERIVED);

    const acct2Snaps = await snapshots.listForAccount(acct2);
    expect(acct2Snaps).toHaveLength(1);
    expect(acct2Snaps[0].totalValue).toBe(5 * 200); // 1000

    const acct3Snaps = await snapshots.listForAccount(acct3);
    expect(acct3Snaps).toEqual([]);
  });

  it('uses today as the snapshotDate ISO string', async () => {
    const acctId = await makeAccount('Brokerage', AccountType.ACCOUNT_BROKERAGE);
    await holdings.create({
      accountId: acctId,
      ticker: 'VTI',
      shareCount: 1,
      targetAllocationPct: null,
      costBasis: null,
    });

    const today = new Date(Date.UTC(2026, 4, 19)); // 2026-05-19
    await deriveTodaysSnapshot({ accounts, holdings, snapshots, prices }, today);

    const snaps = await snapshots.listForAccount(acctId);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].snapshotDate).toBe('2026-05-19');
  });

  it('idempotent — running twice on the same day overwrites rather than duplicating', async () => {
    const acctId = await makeAccount('Brokerage', AccountType.ACCOUNT_BROKERAGE);
    await holdings.create({
      accountId: acctId,
      ticker: 'VTI',
      shareCount: 4,
      targetAllocationPct: null,
      costBasis: null,
    });

    const today = new Date(Date.UTC(2026, 4, 19));
    await deriveTodaysSnapshot({ accounts, holdings, snapshots, prices }, today);
    await deriveTodaysSnapshot({ accounts, holdings, snapshots, prices }, today);

    const snaps = await snapshots.listForAccount(acctId);
    // UNIQUE(account_id, snapshot_date) → upsert collapses second call.
    expect(snaps).toHaveLength(1);
    expect(snaps[0].snapshotDate).toBe('2026-05-19');
    expect(snaps[0].totalValue).toBe(4 * 250);
    // currentPrice was called once per derivation (2 calls total for VTI).
    expect(currentFn).toHaveBeenCalledTimes(2);
  });

  it('skips holdings whose price lookup fails (logged but not fatal)', async () => {
    const acctId = await makeAccount('Brokerage', AccountType.ACCOUNT_BROKERAGE);
    await holdings.create({
      accountId: acctId,
      ticker: 'GOOD',
      shareCount: 3,
      targetAllocationPct: null,
      costBasis: null,
    });
    await holdings.create({
      accountId: acctId,
      ticker: 'BAD',
      shareCount: 7,
      targetAllocationPct: null,
      costBasis: null,
    });

    const flakyPrices: PriceCacheAPI = {
      historicalPrice: vi.fn(),
      currentPrice: vi.fn(async (ticker: string) => {
        if (ticker === 'BAD') throw new Error('Yahoo lookup failed');
        return 50;
      }),
    };

    const result = await deriveTodaysSnapshot({
      accounts,
      holdings,
      snapshots,
      prices: flakyPrices,
    });

    // Function returns successfully despite the per-ticker error.
    expect(result.upserted).toContain(acctId);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('BAD');

    const snaps = await snapshots.listForAccount(acctId);
    expect(snaps).toHaveLength(1);
    // Only GOOD contributed — 3 × 50 = 150. BAD was swallowed.
    expect(snaps[0].totalValue).toBe(3 * 50);
  });
});
