// src/market/fund-holdings-sync.ts
import type { YahooClient } from './yahoo-client';
import type { FundHoldingsRepo } from '@/domain/fund-holdings';
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

export async function syncStaleFunds(
  deps: {
    yahoo: YahooClient;
    fundHoldings: FundHoldingsRepo;
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
      if (result.holdings.length > 0) {
        await deps.fundHoldings.upsertHoldings(ticker, result.holdings, result.asOf);
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
