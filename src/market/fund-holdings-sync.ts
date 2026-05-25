// src/market/fund-holdings-sync.ts
import type { YahooClient } from './yahoo-client';
import type { FundHoldingsRepo } from '@/domain/fund-holdings';
import type { FundSectorsRepo } from '@/domain/fund-sectors';
import type { TickersRepo } from '@/domain/tickers';
import type { HoldingsRepo } from '@/domain/holdings';
import type { AssetClass } from '@/types/schema';

const FUND_ASSET_CLASSES = new Set<AssetClass>([
  'US_TOTAL_MARKET', 'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
  'INTL_DEVELOPED', 'EMERGING_MARKETS', 'US_BONDS', 'INTL_BONDS', 'TIPS',
  'REAL_ESTATE', 'COMMODITIES',
]);
const STALE_DAYS = 90;

export interface SyncResult {
  refreshed: string[];
  skipped: string[];
  errors: string[];
}

/**
 * For each unique fund ticker the user holds, refresh Yahoo's top holdings AND
 * sector weightings if either is stale (>90 days) or absent. Both come from
 * the same `quoteSummary?modules=topHoldings` response (parsed by
 * `fundTopHoldings` and `fundSectorWeightings`) but Yahoo returns separate
 * blocks — a fund may have one without the other (e.g. pure bond ETFs have
 * holdings but all-zero sectorWeightings).
 *
 * `fundSectors` is intentionally optional. The earlier signature only handled
 * holdings; callers that haven't been upgraded (run-market-data-refresh, the
 * Investments page Refresh button, existing tests) still work — they just
 * don't populate sectors. New callers pass `fundSectors` to get both.
 */
export async function syncStaleFunds(
  deps: {
    yahoo: YahooClient;
    fundHoldings: FundHoldingsRepo;
    fundSectors?: FundSectorsRepo;
    tickers: TickersRepo;
    holdings: HoldingsRepo;
  },
  today: Date = new Date(),
): Promise<SyncResult> {
  const allHoldings = await deps.holdings.listAll();
  const uniqueTickers = [...new Set(allHoldings.map((h) => h.ticker))];
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const todayIso = today.toISOString().slice(0, 10);

  for (const ticker of uniqueTickers) {
    const t = await deps.tickers.lookup(ticker);
    if (!t || !FUND_ASSET_CLASSES.has(t.assetClass)) {
      skipped.push(ticker);
      continue;
    }
    const asOf = await deps.fundHoldings.getAsOf(ticker);
    if (asOf) {
      const ageDays = (Date.parse(todayIso) - Date.parse(asOf)) / 86_400_000;
      if (ageDays < STALE_DAYS) {
        skipped.push(ticker);
        continue;
      }
    }
    try {
      const result = await deps.yahoo.fundTopHoldings(ticker);
      // Run sector fetch in parallel-by-await: only if a sectors repo was
      // provided. Sectors and holdings come from the same quoteSummary
      // response but Yahoo charges us the same regardless of how many fields
      // we read, so this is a "free" follow-up request.
      let sectorResult: { sectors: { sector: string; weight: number }[]; asOf: string } | null = null;
      if (deps.fundSectors) {
        try {
          sectorResult = await deps.yahoo.fundSectorWeightings(ticker);
        } catch {
          // Sector failure must not block holdings — bond ETFs etc. legitimately
          // have no sectorWeightings, and one missing field shouldn't poison
          // the holdings refresh.
          sectorResult = null;
        }
      }

      if (result.holdings.length > 0) {
        await deps.fundHoldings.upsertHoldings(ticker, result.holdings, result.asOf);
        if (deps.fundSectors && sectorResult && sectorResult.sectors.length > 0) {
          await deps.fundSectors.upsertSectors(ticker, sectorResult.sectors, sectorResult.asOf);
        }
        refreshed.push(ticker);
      } else if (deps.fundSectors && sectorResult && sectorResult.sectors.length > 0) {
        // Some funds (smaller or international) return sector weightings even
        // when topHoldings.holdings is empty. Persist what we have so the
        // sector donut still has data, and count the ticker as refreshed.
        await deps.fundSectors.upsertSectors(ticker, sectorResult.sectors, sectorResult.asOf);
        refreshed.push(ticker);
      } else {
        skipped.push(ticker);
      }
    } catch (e) {
      errors.push(`${ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { refreshed, skipped, errors };
}
