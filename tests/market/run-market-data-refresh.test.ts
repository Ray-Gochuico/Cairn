import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountType } from '@/types/enums';
import { runMarketDataRefresh } from '@/market/run-market-data-refresh';
import * as tickerEnrichment from '@/market/ticker-enrichment';
import * as dailySnapshot from '@/market/daily-snapshot';
import * as fundSync from '@/market/fund-holdings-sync';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useFundSectorsStore } from '@/stores/fund-sectors-store';
import { useTickersStore } from '@/stores/tickers-store';

describe('runMarketDataRefresh', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
    vi.restoreAllMocks();
  });

  it('returns synchronously without throwing on an empty database', () => {
    // No accounts/holdings/tickers seeded — the three derivations are
    // fire-and-forget IIFEs that swallow their own errors. The call itself
    // must not throw and must not return a rejected promise.
    expect(() => runMarketDataRefresh(db)).not.toThrow();
  });

  it('does not reject when awaited', async () => {
    await expect(
      Promise.resolve(runMarketDataRefresh(db)),
    ).resolves.toBeUndefined();
  });

  it('enriches every distinct held ticker (lazy sector/industry backfill)', async () => {
    // Per spec § 5: the refresh loop must call enrichTickerIfMissing once
    // per distinct held ticker so pre-migration-0016 tickers eventually
    // get a sector populated. The early-exit on existing.sector inside
    // enrichTickerIfMissing keeps this cheap for already-enriched tickers.
    //
    // Regression test for the Critical issue flagged in the Sub-Plan A
    // final review: prior to this fix, no refresh path called
    // enrichTickerIfMissing, so a ticker that pre-dated the feature
    // stayed "Unclassified" forever.
    const accounts = new AccountsRepo(db);
    const holdings = new HoldingsRepo(db);
    const accountId = await accounts.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage',
      institution: null,
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });
    // Two holdings on AAPL (same ticker → deduped) + one on MSFT.
    await holdings.create({ accountId, ticker: 'AAPL', shareCount: 10, targetAllocationPct: null, costBasis: null });
    await holdings.create({ accountId, ticker: 'AAPL', shareCount: 5, targetAllocationPct: null, costBasis: null });
    await holdings.create({ accountId, ticker: 'MSFT', shareCount: 20, targetAllocationPct: null, costBasis: null });

    const enrichSpy = vi
      .spyOn(tickerEnrichment, 'enrichTickerIfMissing')
      .mockResolvedValue(false);

    runMarketDataRefresh(db);

    // The enrichment runs inside a fire-and-forget IIFE. Flush microtasks
    // by yielding the event loop a few times so the listAll() + spy calls
    // resolve before we assert.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // Once per distinct ticker (AAPL twice in holdings → counted once).
    const calledTickers = enrichSpy.mock.calls.map((c) => c[0]);
    expect(calledTickers.sort()).toEqual(['AAPL', 'MSFT']);
  });

  describe('daily-snapshot store refeed (Wave 2 §3)', () => {
    const flush = async () => {
      // The derivation runs inside a fire-and-forget IIFE — yield a few turns.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    };

    let loadSpy: ReturnType<typeof vi.fn>;
    let originalLoad: () => Promise<void>;

    beforeEach(() => {
      loadSpy = vi.fn().mockResolvedValue(undefined);
      originalLoad = useSnapshotsStore.getState().load;
      useSnapshotsStore.setState({ load: loadSpy });
    });

    afterEach(() => {
      useSnapshotsStore.setState({ load: originalLoad });
    });

    it('reloads the snapshots store when rows were upserted', async () => {
      vi.spyOn(dailySnapshot, 'deriveTodaysSnapshot').mockResolvedValue({
        upserted: [1, 2], skipped: [], partial: [], errors: [],
      });
      runMarketDataRefresh(db);
      await flush();
      expect(loadSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT reload on skipped/partial-only results', async () => {
      vi.spyOn(dailySnapshot, 'deriveTodaysSnapshot').mockResolvedValue({
        upserted: [], skipped: [3], partial: [4], errors: ['4/VTI: offline'],
      });
      runMarketDataRefresh(db);
      await flush();
      expect(loadSpy).not.toHaveBeenCalled();
    });

    it('does NOT reload (and does not crash) when the derivation rejects', async () => {
      vi.spyOn(dailySnapshot, 'deriveTodaysSnapshot').mockRejectedValue(new Error('offline'));
      expect(() => runMarketDataRefresh(db)).not.toThrow();
      await flush();
      expect(loadSpy).not.toHaveBeenCalled();
    });
  });

  describe('fund-sync + enrichment store refeed (round-2 C2)', () => {
    const flush = async () => {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    };

    // Seed one held ticker so the enrichment loop has work (copied from the
    // "enriches every distinct held ticker" seed above, single holding).
    const seedOneHolding = async () => {
      const accounts = new AccountsRepo(db);
      const holdings = new HoldingsRepo(db);
      const accountId = await accounts.create({
        householdId: 1,
        ownerPersonId: null,
        beneficiaryDependentId: null,
        name: 'Brokerage',
        institution: null,
        type: AccountType.ACCOUNT_BROKERAGE,
        cryptoWalletAddress: null,
        autoFetchEnabled: false,
        excludedFromNetWorth: false,
        stateOfPlan: null,
        accentColor: null,
      });
      await holdings.create({ accountId, ticker: 'AAPL', shareCount: 10, targetAllocationPct: null, costBasis: null });
    };

    let fundHoldingsLoad: ReturnType<typeof vi.fn>;
    let fundSectorsLoad: ReturnType<typeof vi.fn>;
    let tickersLoad: ReturnType<typeof vi.fn>;
    let originals: Array<() => Promise<void>>;

    beforeEach(() => {
      fundHoldingsLoad = vi.fn().mockResolvedValue(undefined);
      fundSectorsLoad = vi.fn().mockResolvedValue(undefined);
      tickersLoad = vi.fn().mockResolvedValue(undefined);
      originals = [
        useFundHoldingsStore.getState().load,
        useFundSectorsStore.getState().load,
        useTickersStore.getState().load,
      ];
      useFundHoldingsStore.setState({ load: fundHoldingsLoad });
      useFundSectorsStore.setState({ load: fundSectorsLoad });
      useTickersStore.setState({ load: tickersLoad });
    });

    afterEach(() => {
      useFundHoldingsStore.setState({ load: originals[0] });
      useFundSectorsStore.setState({ load: originals[1] });
      useTickersStore.setState({ load: originals[2] });
    });

    it('reloads fund-holdings AND fund-sectors when the sync refreshed a fund', async () => {
      vi.spyOn(fundSync, 'syncStaleFunds').mockResolvedValue({
        refreshed: ['VTI'], skipped: [], errors: [],
      });
      runMarketDataRefresh(db);
      await flush();
      expect(fundHoldingsLoad).toHaveBeenCalledTimes(1);
      expect(fundSectorsLoad).toHaveBeenCalledTimes(1);
    });

    it('does NOT reload the fund stores on a skipped-only sync', async () => {
      vi.spyOn(fundSync, 'syncStaleFunds').mockResolvedValue({
        refreshed: [], skipped: ['VTI'], errors: [],
      });
      runMarketDataRefresh(db);
      await flush();
      expect(fundHoldingsLoad).not.toHaveBeenCalled();
      expect(fundSectorsLoad).not.toHaveBeenCalled();
    });

    it('does NOT reload (and does not crash) when the sync rejects', async () => {
      vi.spyOn(fundSync, 'syncStaleFunds').mockRejectedValue(new Error('offline'));
      expect(() => runMarketDataRefresh(db)).not.toThrow();
      await flush();
      expect(fundHoldingsLoad).not.toHaveBeenCalled();
    });

    it('reloads the tickers store once when any enrichment wrote a row', async () => {
      await seedOneHolding();
      vi.spyOn(tickerEnrichment, 'enrichTickerIfMissing').mockResolvedValue(true);
      runMarketDataRefresh(db);
      await flush();
      expect(tickersLoad).toHaveBeenCalledTimes(1);
    });

    it('does NOT reload the tickers store when every enrichment was a no-op', async () => {
      await seedOneHolding();
      vi.spyOn(tickerEnrichment, 'enrichTickerIfMissing').mockResolvedValue(false);
      runMarketDataRefresh(db);
      await flush();
      expect(tickersLoad).not.toHaveBeenCalled();
    });
  });
});
