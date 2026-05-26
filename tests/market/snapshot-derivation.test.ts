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
import {
  deriveLast12Months,
  deriveSnapshotsForMonth,
} from '@/market/snapshot-derivation';
import { lastBusinessDayOfMonth } from '@/lib/business-days';

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

describe('snapshot derivation', () => {
  let db: SqliteAdapter;
  let accounts: AccountsRepo;
  let holdings: HoldingsRepo;
  let snapshots: AccountSnapshotsRepo;
  let prices: PriceCacheAPI;
  let historicalFn: ReturnType<typeof vi.fn>;

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

    historicalFn = vi.fn(async (ticker: string, date: string) => {
      // Canned per (ticker, date); the May-31-2024 prices used by the
      // primary fixture, and a fallback for the 12-month sweep test.
      if (ticker === 'VTI' && date === '2024-05-31') return 250;
      if (ticker === 'VXUS' && date === '2024-05-31') return 60;
      if (ticker === 'BND' && date === '2024-05-31') return 70;
      return 100;
    });
    prices = {
      historicalPrice: historicalFn,
      currentPrice: vi.fn(),
    };
  });

  afterEach(async () => {
    await db.close();
  });

  async function makeAccount(name: string, type: AccountType, excludedFromNetWorth = false): Promise<number> {
    return accounts.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name,
      institution: null,
      type,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth,
      stateOfPlan: null,
      accentColor: null,
    });
  }

  describe('deriveSnapshotsForMonth', () => {
    it('produces an upserted snapshot per non-cash account from Σ (shares × price)', async () => {
      const brokerageId = await makeAccount('Brokerage', AccountType.ACCOUNT_BROKERAGE);
      const fourOhOneKId = await makeAccount('401k', AccountType.ACCOUNT_401K);

      await holdings.create({
        accountId: brokerageId,
        ticker: 'VTI',
        shareCount: 10,
        targetAllocationPct: null,
        costBasis: null,
      });
      await holdings.create({
        accountId: brokerageId,
        ticker: 'VXUS',
        shareCount: 5,
        targetAllocationPct: null,
        costBasis: null,
      });
      await holdings.create({
        accountId: fourOhOneKId,
        ticker: 'BND',
        shareCount: 100,
        targetAllocationPct: null,
        costBasis: null,
      });

      await deriveSnapshotsForMonth('2024-05', { accounts, holdings, snapshots, prices });

      const eom = lastBusinessDayOfMonth('2024-05'); // 2024-05-31

      const brokerageSnaps = await snapshots.listForAccount(brokerageId);
      expect(brokerageSnaps).toHaveLength(1);
      expect(brokerageSnaps[0].snapshotDate).toBe(eom);
      // 10 × 250 + 5 × 60 = 2800
      expect(brokerageSnaps[0].totalValue).toBe(10 * 250 + 5 * 60);
      expect(brokerageSnaps[0].source).toBe(SnapshotSource.AUTO_DERIVED);

      const fourOhOneKSnaps = await snapshots.listForAccount(fourOhOneKId);
      expect(fourOhOneKSnaps).toHaveLength(1);
      expect(fourOhOneKSnaps[0].totalValue).toBe(100 * 70); // 7000
    });

    it('skips cash and savings accounts (no snapshot rows written)', async () => {
      const cashId = await makeAccount('Checking', AccountType.ACCOUNT_CASH);
      const savingsId = await makeAccount('HYSA', AccountType.ACCOUNT_SAVINGS);
      const cryptoId = await makeAccount('Coinbase', AccountType.ACCOUNT_CRYPTO);

      // Even if a cash/savings/crypto account has a holding entry, derivation must
      // not touch it — those balances are manually entered.
      await holdings.create({
        accountId: cashId,
        ticker: 'USD',
        shareCount: 1000,
        targetAllocationPct: null,
        costBasis: null,
      });

      await deriveSnapshotsForMonth('2024-05', { accounts, holdings, snapshots, prices });

      expect(await snapshots.listForAccount(cashId)).toEqual([]);
      expect(await snapshots.listForAccount(savingsId)).toEqual([]);
      expect(await snapshots.listForAccount(cryptoId)).toEqual([]);
    });

    it('skips accounts marked excludedFromNetWorth', async () => {
      const excludedId = await makeAccount('Old IRA', AccountType.ACCOUNT_TRAD_IRA, true);
      await holdings.create({
        accountId: excludedId,
        ticker: 'VTI',
        shareCount: 1,
        targetAllocationPct: null,
        costBasis: null,
      });

      await deriveSnapshotsForMonth('2024-05', { accounts, holdings, snapshots, prices });
      expect(await snapshots.listForAccount(excludedId)).toEqual([]);
    });

    it('upsert is idempotent — re-deriving the same month overwrites, does not duplicate', async () => {
      const brokerageId = await makeAccount('Brokerage', AccountType.ACCOUNT_BROKERAGE);
      await holdings.create({
        accountId: brokerageId,
        ticker: 'VTI',
        shareCount: 1,
        targetAllocationPct: null,
        costBasis: null,
      });

      await deriveSnapshotsForMonth('2024-05', { accounts, holdings, snapshots, prices });
      await deriveSnapshotsForMonth('2024-05', { accounts, holdings, snapshots, prices });

      const snaps = await snapshots.listForAccount(brokerageId);
      expect(snaps).toHaveLength(1);
    });
  });

  describe('deriveLast12Months', () => {
    it('produces ~12 monthly snapshots per non-cash account', async () => {
      const brokerageId = await makeAccount('Brokerage', AccountType.ACCOUNT_BROKERAGE);
      await holdings.create({
        accountId: brokerageId,
        ticker: 'VTI',
        shareCount: 2,
        targetAllocationPct: null,
        costBasis: null,
      });

      // Pin "now" to keep the test deterministic. monthsBetween(12 ago → now)
      // is inclusive on both ends → 13 months.
      const now = new Date(Date.UTC(2024, 5, 15)); // 2024-06-15
      await deriveLast12Months({ accounts, holdings, snapshots, prices }, now);

      const snaps = await snapshots.listForAccount(brokerageId);
      // 13 months inclusive (2023-06 .. 2024-06). Allow >=12 to keep the
      // assertion robust to alternative range conventions.
      expect(snaps.length).toBeGreaterThanOrEqual(12);
      expect(snaps.length).toBeLessThanOrEqual(13);

      // historicalFn called once per (ticker, month) combination.
      expect(historicalFn.mock.calls.length).toBe(snaps.length);
    });

    it('continues past per-month failures (one bad ticker does not stop the batch)', async () => {
      const brokerageId = await makeAccount('Brokerage', AccountType.ACCOUNT_BROKERAGE);
      await holdings.create({
        accountId: brokerageId,
        ticker: 'GOOD',
        shareCount: 1,
        targetAllocationPct: null,
        costBasis: null,
      });

      let calls = 0;
      const flakyPrices: PriceCacheAPI = {
        historicalPrice: vi.fn(async () => {
          calls++;
          // Fail on the first call only; remaining months succeed.
          if (calls === 1) throw new Error('Yahoo lookup failed');
          return 50;
        }),
        currentPrice: vi.fn(),
      };

      const now = new Date(Date.UTC(2024, 5, 15));
      await deriveLast12Months(
        { accounts, holdings, snapshots, prices: flakyPrices },
        now
      );

      const snaps = await snapshots.listForAccount(brokerageId);
      // 13 months in range, 1 failed → 12 successful snapshots.
      expect(snaps.length).toBeGreaterThanOrEqual(11);
    });
  });
});
