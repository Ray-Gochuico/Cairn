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

export function aggregateBySector(
  perTicker: ReadonlyArray<PerTickerExposure>,
  sectorMap: ReadonlyMap<string, SectorMapEntry>,
): SectorSlice[] {
  const totals = new Map<string, number>();
  for (const { ticker, effectiveExposure } of perTicker) {
    const sector = sectorMap.get(ticker)?.sector ?? 'Unclassified';
    totals.set(sector, (totals.get(sector) ?? 0) + Math.max(0, effectiveExposure));
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
