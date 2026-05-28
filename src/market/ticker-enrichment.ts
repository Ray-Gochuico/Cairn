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

export async function enrichTickerIfMissing(
  ticker: string,
  deps: { yahoo: YahooClient; tickers: TickersRepo },
): Promise<void> {
  const existing = await deps.tickers.lookup(ticker);
  // Skip only when the ticker exists AND already has a sector. A null
  // sector means either (a) the ticker pre-dates migration 0016, or
  // (b) Yahoo couldn't classify it on a previous attempt — either way,
  // retry on the next refresh until something non-null comes back.
  if (existing && existing.sector) return;

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
  } catch {
    // Best-effort: if Yahoo errors, leave fields null. The next refresh will
    // retry (since sector stays null). Concentration math falls back to OTHER.
    // Contract: a ticker is "unclassified / needs user attention" if it has no
    // row OR name IS NULL. The stub row below makes that detection possible
    // from the UI (Tickers input tab + future Investments banner).
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
      } catch {
        // Swallow — function must remain best-effort.
      }
    }
  }
}
