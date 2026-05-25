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

function isFresh(asOf: string | null, todayIso: string): boolean {
  if (!asOf) return false;
  const ageDays = (Date.parse(todayIso) - Date.parse(asOf)) / 86_400_000;
  return ageDays < STALE_DAYS;
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
  // eslint-disable-next-line no-console
  console.log('[syncStaleFunds] start', {
    todayIso,
    uniqueTickers,
    hasFundSectorsRepo: deps.fundSectors != null,
  });

  for (const ticker of uniqueTickers) {
    const t = await deps.tickers.lookup(ticker);
    if (!t || !FUND_ASSET_CLASSES.has(t.assetClass)) {
      // eslint-disable-next-line no-console
      console.log('[syncStaleFunds] skip non-fund', {
        ticker,
        tickerKnown: t != null,
        assetClass: t?.assetClass ?? null,
      });
      skipped.push(ticker);
      continue;
    }
    // Stale-gate holdings and sectors independently. fund_sectors arrived in
    // migration 0021 — existing users with already-fresh fund_holdings would
    // otherwise never trigger a sector fetch, so the sector donut renders as
    // all "Unclassified" until the holdings hit the 90-day staleness window.
    const holdingsAsOf = await deps.fundHoldings.getAsOf(ticker);
    const sectorsAsOf = deps.fundSectors ? await deps.fundSectors.getAsOf(ticker) : null;
    const holdingsFresh = isFresh(holdingsAsOf, todayIso);
    const sectorsFresh = deps.fundSectors ? isFresh(sectorsAsOf, todayIso) : true;
    // eslint-disable-next-line no-console
    console.log('[syncStaleFunds] gate', {
      ticker, holdingsAsOf, sectorsAsOf, holdingsFresh, sectorsFresh,
    });
    if (holdingsFresh && sectorsFresh) {
      skipped.push(ticker);
      continue;
    }
    try {
      // Skip the holdings call entirely when holdings are fresh but sectors
      // need refetching — saves a Yahoo round-trip for the common backfill case.
      const result = holdingsFresh
        ? null
        : await deps.yahoo.fundTopHoldings(ticker);
      let sectorResult: { sectors: { sector: string; weight: number }[]; asOf: string } | null = null;
      if (deps.fundSectors && !sectorsFresh) {
        try {
          sectorResult = await deps.yahoo.fundSectorWeightings(ticker);
        } catch (sectorErr) {
          // Sector failure must not block holdings — bond ETFs etc. legitimately
          // have no sectorWeightings, and one missing field shouldn't poison
          // the holdings refresh.
          // eslint-disable-next-line no-console
          console.error('[syncStaleFunds] fundSectorWeightings rejected (continuing)', {
            ticker,
            error: sectorErr instanceof Error ? { message: sectorErr.message, stack: sectorErr.stack } : sectorErr,
          });
          sectorResult = null;
        }
      }

      let didWrite = false;
      if (result && result.holdings.length > 0) {
        await deps.fundHoldings.upsertHoldings(ticker, result.holdings, result.asOf);
        didWrite = true;
      }
      if (deps.fundSectors && sectorResult && sectorResult.sectors.length > 0) {
        await deps.fundSectors.upsertSectors(ticker, sectorResult.sectors, sectorResult.asOf);
        didWrite = true;
      }
      // eslint-disable-next-line no-console
      console.log('[syncStaleFunds] ticker done', {
        ticker,
        didWrite,
        holdingsLen: result?.holdings.length ?? null,
        sectorsLen: sectorResult?.sectors.length ?? null,
      });
      (didWrite ? refreshed : skipped).push(ticker);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[syncStaleFunds] ticker threw', {
        ticker,
        error: e instanceof Error ? { message: e.message, stack: e.stack } : e,
      });
      errors.push(`${ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log('[syncStaleFunds] done', { refreshed, skipped, errors });
  return { refreshed, skipped, errors };
}
