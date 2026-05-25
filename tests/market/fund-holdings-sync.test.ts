import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncStaleFunds } from '@/market/fund-holdings-sync';
import type { SyncResult } from '@/market/fund-holdings-sync';
import type { YahooClient } from '@/market/yahoo-client';
import type { FundHoldingsRepo } from '@/domain/fund-holdings';
import type { FundSectorsRepo } from '@/domain/fund-sectors';
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

function daysBefore(today: Date, n: number): string {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeYahoo(): Pick<YahooClient, 'fundTopHoldings' | 'fundSectorWeightings'> {
  return {
    fundTopHoldings: vi.fn().mockResolvedValue({
      holdings: [{ symbol: 'AAPL', weight: 0.05 }],
      asOf: '2026-01-01',
    }),
    fundSectorWeightings: vi.fn().mockResolvedValue({
      sectors: [{ sector: 'Technology', weight: 0.28 }],
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

function makeFundSectors(): Pick<FundSectorsRepo, 'getAsOf' | 'upsertSectors'> {
  return {
    getAsOf: vi.fn().mockResolvedValue(null),
    upsertSectors: vi.fn().mockResolvedValue(undefined),
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
      const staleDate = daysBefore(TODAY, 100);
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
      const freshDate = daysBefore(TODAY, 30);
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

  describe('Test 8: when fundSectors repo is provided, sectorWeightings is fetched and upserted', () => {
    it('persists fund sectors alongside holdings', async () => {
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      const fundSectors = makeFundSectors();
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      const result = await syncStaleFunds(
        {
          yahoo: yahoo as unknown as YahooClient,
          fundHoldings: fundHoldings as unknown as FundHoldingsRepo,
          fundSectors: fundSectors as unknown as FundSectorsRepo,
          tickers: tickers as unknown as TickersRepo,
          holdings: holdings as unknown as HoldingsRepo,
        },
        TODAY,
      );

      expect(yahoo.fundSectorWeightings).toHaveBeenCalledWith('VTI');
      expect(fundSectors.upsertSectors).toHaveBeenCalledWith(
        'VTI',
        [{ sector: 'Technology', weight: 0.28 }],
        '2026-01-01',
      );
      expect(result.refreshed).toContain('VTI');
    });
  });

  describe('Test 9: when fundSectors is omitted, sector path is a no-op', () => {
    it('does not call fundSectorWeightings when fundSectors repo is missing', async () => {
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      await syncStaleFunds(
        {
          yahoo: yahoo as unknown as YahooClient,
          fundHoldings: fundHoldings as unknown as FundHoldingsRepo,
          tickers: tickers as unknown as TickersRepo,
          holdings: holdings as unknown as HoldingsRepo,
        },
        TODAY,
      );

      expect(yahoo.fundSectorWeightings).not.toHaveBeenCalled();
    });
  });

  describe('Test 10: bond ETF with empty sectorWeightings still counts as refreshed when holdings are present', () => {
    it('upserts holdings but skips sectors when sectorWeightings returns empty', async () => {
      const yahoo = makeYahoo();
      // BND returns top holdings (treasury issues) but no equity sector weights.
      (yahoo.fundSectorWeightings as ReturnType<typeof vi.fn>).mockResolvedValue({
        sectors: [],
        asOf: '2026-01-01',
      });
      const fundHoldings = makeFundHoldings();
      const fundSectors = makeFundSectors();
      const tickers = makeTickers({ BND: makeTicker('BND', 'US_BONDS') });
      const holdings = makeHoldings([makeHolding(1, 'BND')]);

      const result = await syncStaleFunds(
        {
          yahoo: yahoo as unknown as YahooClient,
          fundHoldings: fundHoldings as unknown as FundHoldingsRepo,
          fundSectors: fundSectors as unknown as FundSectorsRepo,
          tickers: tickers as unknown as TickersRepo,
          holdings: holdings as unknown as HoldingsRepo,
        },
        TODAY,
      );

      expect(fundHoldings.upsertHoldings).toHaveBeenCalled();
      expect(fundSectors.upsertSectors).not.toHaveBeenCalled();
      expect(result.refreshed).toContain('BND');
    });
  });

  describe('Test 11: fund with sectors but empty holdings still refreshes (count as refreshed)', () => {
    it('persists sectors when holdings array is empty but sectors are populated', async () => {
      const yahoo = makeYahoo();
      (yahoo.fundTopHoldings as ReturnType<typeof vi.fn>).mockResolvedValue({
        holdings: [],
        asOf: '2026-01-01',
      });
      (yahoo.fundSectorWeightings as ReturnType<typeof vi.fn>).mockResolvedValue({
        sectors: [{ sector: 'Technology', weight: 0.4 }, { sector: 'Healthcare', weight: 0.2 }],
        asOf: '2026-01-01',
      });
      const fundHoldings = makeFundHoldings();
      const fundSectors = makeFundSectors();
      const tickers = makeTickers({ XLK: makeTicker('XLK', 'US_LARGE_CAP') });
      const holdings = makeHoldings([makeHolding(1, 'XLK')]);

      const result = await syncStaleFunds(
        {
          yahoo: yahoo as unknown as YahooClient,
          fundHoldings: fundHoldings as unknown as FundHoldingsRepo,
          fundSectors: fundSectors as unknown as FundSectorsRepo,
          tickers: tickers as unknown as TickersRepo,
          holdings: holdings as unknown as HoldingsRepo,
        },
        TODAY,
      );

      expect(fundHoldings.upsertHoldings).not.toHaveBeenCalled();
      expect(fundSectors.upsertSectors).toHaveBeenCalledWith(
        'XLK',
        [{ sector: 'Technology', weight: 0.4 }, { sector: 'Healthcare', weight: 0.2 }],
        '2026-01-01',
      );
      expect(result.refreshed).toContain('XLK');
    });
  });

  describe('Test 12: a sectorWeightings fetch failure does NOT block holdings refresh', () => {
    it('persists holdings even when fundSectorWeightings rejects', async () => {
      const yahoo = makeYahoo();
      (yahoo.fundSectorWeightings as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('network blip'),
      );
      const fundHoldings = makeFundHoldings();
      const fundSectors = makeFundSectors();
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      const result = await syncStaleFunds(
        {
          yahoo: yahoo as unknown as YahooClient,
          fundHoldings: fundHoldings as unknown as FundHoldingsRepo,
          fundSectors: fundSectors as unknown as FundSectorsRepo,
          tickers: tickers as unknown as TickersRepo,
          holdings: holdings as unknown as HoldingsRepo,
        },
        TODAY,
      );

      expect(fundHoldings.upsertHoldings).toHaveBeenCalled();
      expect(fundSectors.upsertSectors).not.toHaveBeenCalled();
      expect(result.refreshed).toContain('VTI');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Test 13: fresh holdings + missing sectors triggers a sectors-only backfill', () => {
    it('fetches sectorWeightings (but not topHoldings) when fund_holdings is fresh and fund_sectors is empty', async () => {
      // The regression: existing users with fresh fund_holdings (from before
      // migration 0021) never got fund_sectors populated, so the donut stayed
      // grey. We backfill sectors without redundantly re-pulling holdings.
      const freshDate = daysBefore(TODAY, 30);
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      (fundHoldings.getAsOf as ReturnType<typeof vi.fn>).mockResolvedValue(freshDate);
      const fundSectors = makeFundSectors();
      // sectors.getAsOf returns null by default — no sector rows yet.
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      const result = await syncStaleFunds(
        {
          yahoo: yahoo as unknown as YahooClient,
          fundHoldings: fundHoldings as unknown as FundHoldingsRepo,
          fundSectors: fundSectors as unknown as FundSectorsRepo,
          tickers: tickers as unknown as TickersRepo,
          holdings: holdings as unknown as HoldingsRepo,
        },
        TODAY,
      );

      expect(yahoo.fundTopHoldings).not.toHaveBeenCalled();
      expect(yahoo.fundSectorWeightings).toHaveBeenCalledWith('VTI');
      expect(fundHoldings.upsertHoldings).not.toHaveBeenCalled();
      expect(fundSectors.upsertSectors).toHaveBeenCalledWith(
        'VTI',
        [{ sector: 'Technology', weight: 0.28 }],
        '2026-01-01',
      );
      expect(result.refreshed).toContain('VTI');
    });
  });

  describe('Test 14: both holdings and sectors fresh → skipped (no Yahoo calls)', () => {
    it('does not call Yahoo when fund_holdings and fund_sectors are both fresh', async () => {
      const freshDate = daysBefore(TODAY, 30);
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      (fundHoldings.getAsOf as ReturnType<typeof vi.fn>).mockResolvedValue(freshDate);
      const fundSectors = makeFundSectors();
      (fundSectors.getAsOf as ReturnType<typeof vi.fn>).mockResolvedValue(freshDate);
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      const result = await syncStaleFunds(
        {
          yahoo: yahoo as unknown as YahooClient,
          fundHoldings: fundHoldings as unknown as FundHoldingsRepo,
          fundSectors: fundSectors as unknown as FundSectorsRepo,
          tickers: tickers as unknown as TickersRepo,
          holdings: holdings as unknown as HoldingsRepo,
        },
        TODAY,
      );

      expect(yahoo.fundTopHoldings).not.toHaveBeenCalled();
      expect(yahoo.fundSectorWeightings).not.toHaveBeenCalled();
      expect(result.skipped).toContain('VTI');
      expect(result.refreshed).not.toContain('VTI');
    });
  });

  describe('Test 15: stale sectors trigger a refetch even when holdings are fresh', () => {
    it('refetches sectorWeightings when fund_sectors row is older than 90 days', async () => {
      const freshDate = daysBefore(TODAY, 30);
      const staleSectorsDate = daysBefore(TODAY, 120);
      const yahoo = makeYahoo();
      const fundHoldings = makeFundHoldings();
      (fundHoldings.getAsOf as ReturnType<typeof vi.fn>).mockResolvedValue(freshDate);
      const fundSectors = makeFundSectors();
      (fundSectors.getAsOf as ReturnType<typeof vi.fn>).mockResolvedValue(staleSectorsDate);
      const tickers = makeTickers({ VTI: makeTicker('VTI', 'US_TOTAL_MARKET') });
      const holdings = makeHoldings([makeHolding(1, 'VTI')]);

      const result = await syncStaleFunds(
        {
          yahoo: yahoo as unknown as YahooClient,
          fundHoldings: fundHoldings as unknown as FundHoldingsRepo,
          fundSectors: fundSectors as unknown as FundSectorsRepo,
          tickers: tickers as unknown as TickersRepo,
          holdings: holdings as unknown as HoldingsRepo,
        },
        TODAY,
      );

      expect(yahoo.fundTopHoldings).not.toHaveBeenCalled();
      expect(yahoo.fundSectorWeightings).toHaveBeenCalled();
      expect(fundSectors.upsertSectors).toHaveBeenCalled();
      expect(result.refreshed).toContain('VTI');
    });
  });
});
