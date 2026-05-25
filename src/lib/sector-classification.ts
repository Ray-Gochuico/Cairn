import type { AssetClass } from '@/types/schema';

interface TickerRow {
  ticker: string;
  assetClass: AssetClass;
  sector: string | null;
  industry: string | null;
}

interface PerTickerExposure {
  ticker: string;
  effectiveExposure: number;
}

interface SectorMapEntry { sector: string; industry: string | null; }

/**
 * Per-fund sector breakdown sourced from Yahoo's topHoldings.sectorWeightings.
 * Each entry is `{ sector: 'Technology', weight: 0.28 }`. Weights typically
 * sum to ~1.0 across the 11 GICS sectors but may not — pure bond ETFs return
 * all-zero weights (we drop those at parse time, so the array would be
 * empty here) and missing sectors are implicitly attributed to the fund's
 * pseudo-sector fallback.
 */
export type FundSectorWeights = ReadonlyArray<{ sector: string; weight: number }>;

export interface SectorSlice { name: string; value: number; }

export function resolveSector(ticker: TickerRow): string {
  if (ticker.sector) return ticker.sector;
  return assetClassToPseudoSector(ticker.assetClass);
}

export function assetClassToPseudoSector(cls: AssetClass): string {
  switch (cls) {
    case 'US_BONDS':
    case 'INTL_BONDS':
    case 'TIPS':            return 'Fixed Income';
    case 'REAL_ESTATE':     return 'Real Estate';
    case 'COMMODITIES':     return 'Commodities';
    case 'CRYPTO':          return 'Crypto';
    case 'SINGLE_STOCK':    return 'Unclassified';
    case 'OTHER':           return 'Unclassified';
    case 'US_TOTAL_MARKET':
    case 'US_LARGE_CAP':
    case 'US_MID_CAP':
    case 'US_SMALL_CAP':
    case 'INTL_DEVELOPED':
    case 'EMERGING_MARKETS': return 'Unclassified';
    default: return 'Unclassified';
  }
}

export function buildSectorMap(tickers: ReadonlyArray<TickerRow>): Map<string, SectorMapEntry> {
  return new Map(tickers.map((t) => [t.ticker, { sector: resolveSector(t), industry: t.industry }]));
}

/**
 * Aggregate per-ticker effective exposures into per-sector totals.
 *
 * When `fundSectorWeights` is provided and contains a non-empty entry for a
 * given ticker (typically a fund/ETF whose underlying holdings aren't tracked
 * individually in `perTicker`), that ticker's exposure is distributed
 * proportionally across the fund's sector weights, plus any uncovered
 * residual (e.g. 1 - sum-of-weights for partial breakdowns) attributed to
 * the ticker's own pseudo-sector via `sectorMap`. Without this distribution,
 * funds bucket entirely into "Unclassified" (the asset-class pseudo-sector
 * fallback for US_TOTAL_MARKET et al.) and the sector donut renders grey.
 */
export function aggregateBySector(
  perTicker: ReadonlyArray<PerTickerExposure>,
  sectorMap: ReadonlyMap<string, SectorMapEntry>,
  fundSectorWeights?: ReadonlyMap<string, FundSectorWeights>,
): SectorSlice[] {
  const totals = new Map<string, number>();
  for (const { ticker, effectiveExposure } of perTicker) {
    const exposure = Math.max(0, effectiveExposure);
    if (exposure === 0) continue;
    const weights = fundSectorWeights?.get(ticker);
    if (weights && weights.length > 0) {
      // Distribute the fund's exposure across the sector weights. Any
      // shortfall (rare but possible — Yahoo may omit a sector entirely)
      // lands in the fund's own pseudo-sector so totals still sum to the
      // fund's full exposure rather than silently shrinking the donut.
      let totalCovered = 0;
      for (const { sector, weight } of weights) {
        const contrib = exposure * weight;
        totals.set(sector, (totals.get(sector) ?? 0) + contrib);
        totalCovered += weight;
      }
      const uncovered = Math.max(0, 1 - totalCovered);
      if (uncovered > 1e-9) {
        const fallbackSector = sectorMap.get(ticker)?.sector ?? 'Unclassified';
        totals.set(fallbackSector, (totals.get(fallbackSector) ?? 0) + exposure * uncovered);
      }
      continue;
    }
    const sector = sectorMap.get(ticker)?.sector ?? 'Unclassified';
    totals.set(sector, (totals.get(sector) ?? 0) + exposure);
  }
  return Array.from(totals, ([name, value]) => ({ name, value }));
}

export function aggregateByIndustry(
  perTicker: ReadonlyArray<PerTickerExposure>,
  sectorMap: ReadonlyMap<string, SectorMapEntry>,
  selectedSector: string,
): SectorSlice[] {
  const totals = new Map<string, number>();
  for (const { ticker, effectiveExposure } of perTicker) {
    const info = sectorMap.get(ticker);
    if (info?.sector !== selectedSector) continue;
    const industry = info.industry ?? 'Unclassified';
    totals.set(industry, (totals.get(industry) ?? 0) + Math.max(0, effectiveExposure));
  }
  return Array.from(totals, ([name, value]) => ({ name, value }));
}
