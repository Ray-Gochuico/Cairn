// src/market/ticker-enrichment.ts
import type { YahooClient } from './yahoo-client';
import type { TickersRepo } from '@/domain/tickers';
import { detectLeverage } from '@/lib/leverage-detection';
import type { AssetClass } from '@/types/schema';

function mapYahooCategoryToAssetClass(category: string | null, quoteType: string | null): AssetClass {
  if (quoteType === 'CRYPTOCURRENCY') return 'CRYPTO';
  if (quoteType === 'EQUITY') return 'SINGLE_STOCK';
  if (!category) return 'OTHER';
  const c = category.toLowerCase();
  // Check international/foreign before domestic cap-size checks because
  // Morningstar uses names like "Foreign Large Blend" that would otherwise
  // match the "large blend" domestic rule.
  if (c.includes('foreign') || c.includes('international') || c.includes('developed')) return 'INTL_DEVELOPED';
  if (c.includes('emerging')) return 'EMERGING_MARKETS';
  if (c.includes('total stock')) return 'US_TOTAL_MARKET';
  if (c.includes('large blend') || c.includes('large growth') || c.includes('large value')) return 'US_LARGE_CAP';
  if (c.includes('mid')) return 'US_MID_CAP';
  if (c.includes('small')) return 'US_SMALL_CAP';
  if (c.includes('tips')) return 'TIPS';
  if (c.includes('bond')) return 'US_BONDS';
  if (c.includes('real estate')) return 'REAL_ESTATE';
  if (c.includes('commodit')) return 'COMMODITIES';
  return 'OTHER';
}

/**
 * Best-effort sector/industry enrichment for one ticker. Returns TRUE when
 * any tickers-table row was written (re-enrichment, first-encounter row, or
 * the unclassified stub on a Yahoo failure) so callers know whether the
 * tickers store needs a refeed (round-2 C2); FALSE on the already-enriched
 * early skip or when a failure wrote nothing.
 */
export async function enrichTickerIfMissing(
  ticker: string,
  deps: { yahoo: YahooClient; tickers: TickersRepo },
): Promise<boolean> {
  const existing = await deps.tickers.lookup(ticker);
  // Skip only when the ticker exists AND already has a sector. A null
  // sector means either (a) the ticker pre-dates migration 0016, or
  // (b) Yahoo couldn't classify it on a previous attempt — either way,
  // retry on the next refresh until something non-null comes back.
  if (existing && existing.sector) return false;

  try {
    // For existing tickers, name/assetClass/leverage are already populated, so we
    // only need assetProfile for the sector backfill. New tickers need both calls.
    const [assetProfile, fundProfile] = await Promise.all([
      deps.yahoo.assetProfile(ticker),
      existing ? Promise.resolve(null) : deps.yahoo.fundProfile(ticker),
    ]);

    if (existing) {
      // Re-enrich: preserve name/assetClass/leverage/direction/accentColor,
      // overwrite only sector + industry with the fresh Yahoo values.
      await deps.tickers.upsert({
        ...existing,
        sector: assetProfile.sector,
        industry: assetProfile.industry,
      });
    } else {
      // First encounter — derive assetClass + leverage from fundProfile.
      const assetClass = mapYahooCategoryToAssetClass(fundProfile!.category, fundProfile!.quoteType);
      const { leverageFactor, direction } = detectLeverage(ticker, fundProfile!.category);
      await deps.tickers.upsert({
        ticker,
        name: fundProfile!.category,
        assetClass,
        leverageFactor,
        direction,
        userAdded: false,
        accentColor: null,
        sector: assetProfile.sector,
        industry: assetProfile.industry,
      });
    }
    return true;
  } catch {
    // Best-effort: if Yahoo errors, leave fields null. The next refresh will
    // retry (since sector stays null). Concentration math falls back to OTHER.
    // Contract (W19): a ticker is "unclassified / needs user attention" if it
    // has no row OR (name IS NULL AND asset_class = 'OTHER') — exactly the
    // stub shape written below. name IS NULL alone is NOT a failure signal:
    // a successful equity/crypto enrichment also leaves name null (Yahoo's
    // Morningstar category is null for quoteType EQUITY) while setting a
    // real assetClass. The Investments banner mirrors this predicate.
    if (!existing) {
      try {
        await deps.tickers.upsert({
          ticker,
          name: null,
          assetClass: 'OTHER',
          leverageFactor: 1.0,
          direction: 'LONG',
          userAdded: false,
          accentColor: null,
          sector: null,
          industry: null,
        });
        return true; // stub row written — unclassified detection needs the refeed
      } catch {
        // Swallow — function must remain best-effort.
      }
    }
  }
  return false;
}

/**
 * Refresh the 52-week range AND regular-market day change for one ticker
 * (D-P4 revised / D-PT14 / Wave B D-WB6). Runs on EVERY refresh — both fact
 * groups drift daily/weekly, so fetch-if-missing would silently stale-date
 * them; every-refresh also auto-backfills rows that pre-date migrations
 * 0053/0055. ONE quoteFacts call (modules summaryDetail + price — the same
 * single network request the 52-week fetch already made), then TWO
 * group-independent targeted writes: a group writes only when at least one
 * of its fields came back, so a missing Yahoo module for one group never
 * clobbers the other group's stored values. Partial groups write (the
 * shipped partial-52-week semantics, applied per group). Best-effort like
 * enrichTickerIfMissing: errors are swallowed → false. Row creation stays
 * enrichTickerIfMissing's job — both writes are missing-row no-ops.
 */
export async function updateTicker52WeekAndDayChange(
  ticker: string,
  deps: { yahoo: YahooClient; tickers: TickersRepo },
): Promise<boolean> {
  try {
    const facts = await deps.yahoo.quoteFacts(ticker);
    let wrote = false;
    if (facts.fiftyTwoWeekLow !== null || facts.fiftyTwoWeekHigh !== null) {
      await deps.tickers.set52Week(ticker, facts.fiftyTwoWeekLow, facts.fiftyTwoWeekHigh);
      wrote = true;
    }
    if (facts.regularMarketChange !== null || facts.regularMarketPreviousClose !== null) {
      await deps.tickers.setDayChange(ticker, facts.regularMarketChange, facts.regularMarketPreviousClose);
      wrote = true;
    }
    return wrote;
  } catch {
    return false;
  }
}
