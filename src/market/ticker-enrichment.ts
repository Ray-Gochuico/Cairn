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
  if (existing) return;
  try {
    const profile = await deps.yahoo.fundProfile(ticker);
    const assetClass = mapYahooCategoryToAssetClass(profile.category, profile.quoteType);
    const { leverageFactor, direction } = detectLeverage(ticker, profile.category);
    await deps.tickers.upsert({
      ticker,
      name: profile.category,
      assetClass,
      leverageFactor,
      direction,
      userAdded: false,
      accentColor: null,
    });
  } catch {
    // Best-effort: if Yahoo errors, leave the ticker absent. Concentration math falls back to OTHER.
  }
}
