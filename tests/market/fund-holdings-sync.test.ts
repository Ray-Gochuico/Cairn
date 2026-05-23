import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncStaleFunds } from '@/market/fund-holdings-sync';
import type { SyncResult } from '@/market/fund-holdings-sync';
import type { YahooClient } from '@/market/yahoo-client';
import type { FundHoldingsRepo } from '@/domain/fund-holdings';
import type { TickersRepo } from '@/domain/tickers';
import type { HoldingsRepo } from '@/domain/holdings';
import type { Holding, Ticker } from '@/types/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTicker(ticker: string, assetClass: string): Ticker {
  return {
    ticker,
    name: null,
    assetClass: assetClass as Ticker['assetClass'],
    leverageFactor: 1.0,
    direction: 'LONG',
    userAdded: false,
    accentColor: null,
  };
}

function makeHolding(id: number, ticker: string): Holding {
  return {
    id,
    accountId: 1,
    ticker,
    shareCount: 10,
    targetAllocationPct: null,
    costBasis: null,
  };
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeYahoo(): Pick<YahooClient, 'fundTopHoldings'> {
  return {
    fundTopHoldings: vi.fn().mockResolvedValue({
      holdings: [{ symbol: 'AAPL', weight: 0.05 }],
      asOf: '2026-01-01',
    }),
  };
}

function makeFundHoldings(): Pick<FundHoldingsRepo, 'getAsOf' | 'upsertHoldings'> {
  return {
    getAsOf: vi.fn().mockResolvedValue(null),
    upsertHoldings: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTickers(
  lookupMap: Record<string, Ticker | null>
): Pick<TickersRepo, 'lookup'> {
  return {
    lookup: vi.fn().mockImplementation((ticker: string) =>
      Promise.resolve(lookupMap[ticker] ?? null)
    ),
  };
}

function makeHoldings(items: Holding[]): Pick<HoldingsRepo, 'listAll'> {
  return {
    listAll: vi.fn().mockResolvedValue(items),
  };
}

// Fixed "today" for deterministic age calculations
const TODAY = new Date('2026-05-14T00:00:00Z');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncStaleFunds', () => {
  describe('Test 1: Only fetches for funds, not single stocks or crypto', () => {
    it('calls fundTopHoldings only for fund tickers; non-funds land in skipped', async () => {
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      const tickers = makeTickers({
        VTI: makeTicker('VTI', 'US_TOTAL_MARKET'),
        AAPL: makeTicker('AAPL', 'SINGLE_STOCK'),
        'BTC-USD': makeTicker('BTC-USD', 'CRYPTO'),
      });
      const holdings = makeHoldings([
        makeHolding(1, 'VTI'),
        makeHolding(2, 'AAPL'),
        makeHolding(3, 'BTC-USD'),
      ]);

      const result: SyncResult = await syncStaleFunds(
        { yahoo: yahoo as unknown as YahooClient, fundHoldings: fundHoldings as unknown as FundHoldingsRepo, tickers: tickers as unknown as TickersRepo, holdings: holdings as unknown as HoldingsRepo },
        TODAY,
      );

      // Yahoo is called only for VTI
      expect(yahoo.fundTopHoldings).toHaveBeenCalledTimes(1);
      expect(yahoo.fundTopHoldings).toHaveBeenCalledWith('VTI');

      // AAPL and BTC-USD are in skipped
      expect(result.skipped).toContain('AAPL');
      expect(result.skipped).toContain('BTC-USD');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Test 2: Refreshes when stale (asOf > 90 days old)', () => {
    it('calls fundTopHoldings and upsertHoldings when data is 100 days old', async () => {
      const staleDate = daysAgoIso(100);
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      (fundHoldings.getAsOf as ReturnType<typeof vi.fn>).mockResolvedValue(staleDate);
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      const result = await syncStaleFunds(
        { yahoo: yahoo as unknown as YahooClient, fundHoldings: fundHoldings as unknown as FundHoldingsRepo, tickers: tickers as unknown as TickersRepo, holdings: holdings as unknown as HoldingsRepo },
        TODAY,
      );

      expect(yahoo.fundTopHoldings).toHaveBeenCalledWith('VTI');
      expect(fundHoldings.upsertHoldings).toHaveBeenCalledWith(
        'VTI',
        [{ symbol: 'AAPL', weight: 0.05 }],
        '2026-01-01',
      );
      expect(result.refreshed).toContain('VTI');
      expect(result.skipped).not.toContain('VTI');
    });
  });

  describe('Test 3: Skips when fresh (asOf < 90 days)', () => {
    it('does NOT call fundTopHoldings when data is only 30 days old', async () => {
      const freshDate = daysAgoIso(30);
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      (fundHoldings.getAsOf as ReturnType<typeof vi.fn>).mockResolvedValue(freshDate);
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      const result = await syncStaleFunds(
        { yahoo: yahoo as unknown as YahooClient, fundHoldings: fundHoldings as unknown as FundHoldingsRepo, tickers: tickers as unknown as TickersRepo, holdings: holdings as unknown as HoldingsRepo },
        TODAY,
      );

      expect(yahoo.fundTopHoldings).not.toHaveBeenCalled();
      expect(result.skipped).toContain('VTI');
      expect(result.refreshed).not.toContain('VTI');
    });
  });

  describe('Test 4: Always fetches when fund has no rows yet (getAsOf returns null)', () => {
    it('calls fundTopHoldings when getAsOf returns null', async () => {
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      // getAsOf already mocked to return null by default
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      const result = await syncStaleFunds(
        { yahoo: yahoo as unknown as YahooClient, fundHoldings: fundHoldings as unknown as FundHoldingsRepo, tickers: tickers as unknown as TickersRepo, holdings: holdings as unknown as HoldingsRepo },
        TODAY,
      );

      expect(yahoo.fundTopHoldings).toHaveBeenCalledWith('VTI');
      expect(fundHoldings.upsertHoldings).toHaveBeenCalled();
      expect(result.refreshed).toContain('VTI');
    });
  });

  describe('Test 5: Yahoo errors are caught; function continues and records failure', () => {
    it('records error in errors array but does not throw; continues processing other tickers', async () => {
      const yahoo = makeYahoo();
      (yahoo.fundTopHoldings as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('rate limited'))   // VTI fails
        .mockResolvedValueOnce({
          holdings: [{ symbol: 'VNQ', weight: 0.03 }],
          asOf: '2026-01-01',
        }); // VXUS succeeds

      const fundHoldings = makeFundHoldings();
      const tickers = makeTickers({
        VTI: makeTicker('VTI', 'US_TOTAL_MARKET'),
        VXUS: makeTicker('VXUS', 'INTL_DEVELOPED'),
      });
      const holdings = makeHoldings([
        makeHolding(1, 'VTI'),
        makeHolding(2, 'VXUS'),
      ]);

      const result = await syncStaleFunds(
        { yahoo: yahoo as unknown as YahooClient, fundHoldings: fundHoldings as unknown as FundHoldingsRepo, tickers: tickers as unknown as TickersRepo, holdings: holdings as unknown as HoldingsRepo },
        TODAY,
      );

      // Should NOT throw
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('VTI');
      expect(result.errors[0]).toContain('rate limited');

      // VXUS should still be refreshed
      expect(result.refreshed).toContain('VXUS');
    });
  });

  describe('Test 6: Empty top-10 from Yahoo does not call upsertHoldings', () => {
    it('skips upsert when Yahoo returns empty holdings array; ticker lands in skipped', async () => {
      const yahoo = makeYahoo();
      (yahoo.fundTopHoldings as ReturnType<typeof vi.fn>).mockResolvedValue({
        holdings: [],
        asOf: '2026-01-01',
      });

      const fundHoldings = makeFundHoldings();
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      const result = await syncStaleFunds(
        { yahoo: yahoo as unknown as YahooClient, fundHoldings: fundHoldings as unknown as FundHoldingsRepo, tickers: tickers as unknown as TickersRepo, holdings: holdings as unknown as HoldingsRepo },
        TODAY,
      );

      // upsertHoldings must NOT be called — don't blank out existing data
      expect(fundHoldings.upsertHoldings).not.toHaveBeenCalled();

      // VTI ends up in skipped (not errors, not refreshed)
      expect(result.skipped).toContain('VTI');
      expect(result.refreshed).not.toContain('VTI');
      expect(result.errors).not.toContain('VTI');
    });
  });

  describe('Test 7: Unknown ticker (not in tickers table) is treated as skipped', () => {
    it('places ticker in skipped when tickers.lookup returns null', async () => {
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      // UNKN not in the map → lookup returns null
      const tickers = makeTickers({});
      const holdings = makeHoldings([makeHolding(1, 'UNKN')]);

      const result = await syncStaleFunds(
        { yahoo: yahoo as unknown as YahooClient, fundHoldings: fundHoldings as unknown as FundHoldingsRepo, tickers: tickers as unknown as TickersRepo, holdings: holdings as unknown as HoldingsRepo },
        TODAY,
      );

      expect(yahoo.fundTopHoldings).not.toHaveBeenCalled();
      expect(result.skipped).toContain('UNKN');
      expect(result.refreshed).not.toContain('UNKN');
      expect(result.errors).toHaveLength(0);
    });
  });
});
