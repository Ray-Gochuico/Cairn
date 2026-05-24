import { describe, it, expect } from 'vitest';
import {
  resolveSector,
  assetClassToPseudoSector,
  buildSectorMap,
  aggregateBySector,
  aggregateByIndustry,
} from '@/lib/sector-classification';

const tickers = [
  { ticker: 'AAPL', name: 'Apple', assetClass: 'SINGLE_STOCK', sector: 'Technology',  industry: 'Tech Hardware' },
  { ticker: 'MSFT', name: 'Microsoft', assetClass: 'SINGLE_STOCK', sector: 'Technology', industry: 'Software' },
  { ticker: 'JPM',  name: 'JPMorgan',  assetClass: 'SINGLE_STOCK', sector: 'Financials', industry: 'Banks' },
  { ticker: 'BND',  name: 'Vanguard Bond ETF', assetClass: 'US_BONDS', sector: null, industry: null },
  { ticker: 'VTI',  name: 'Vanguard Total Market', assetClass: 'US_TOTAL_MARKET', sector: null, industry: null },
  { ticker: 'XYZ',  name: 'Unknown',   assetClass: 'SINGLE_STOCK', sector: null, industry: null },
];

const exposures = [
  { ticker: 'AAPL', effectiveExposure: 10_000 },
  { ticker: 'MSFT', effectiveExposure: 8_000 },
  { ticker: 'JPM',  effectiveExposure: 5_000 },
  { ticker: 'BND',  effectiveExposure: 4_000 },
  { ticker: 'XYZ',  effectiveExposure: 1_000 },
];

describe('resolveSector', () => {
  it('uses ticker.sector when present', () => {
    expect(resolveSector(tickers[0] as any)).toBe('Technology');
  });
  it('falls back to assetClassToPseudoSector when sector is null', () => {
    expect(resolveSector(tickers[3] as any)).toBe('Fixed Income');
  });
  it('returns Unclassified for SINGLE_STOCK with no Yahoo sector', () => {
    expect(resolveSector(tickers[5] as any)).toBe('Unclassified');
  });
});

describe('assetClassToPseudoSector', () => {
  it('US_BONDS / INTL_BONDS / TIPS → Fixed Income', () => {
    expect(assetClassToPseudoSector('US_BONDS')).toBe('Fixed Income');
    expect(assetClassToPseudoSector('INTL_BONDS')).toBe('Fixed Income');
    expect(assetClassToPseudoSector('TIPS')).toBe('Fixed Income');
  });
  it('REAL_ESTATE → Real Estate', () => {
    expect(assetClassToPseudoSector('REAL_ESTATE')).toBe('Real Estate');
  });
  it('CRYPTO → Crypto', () => {
    expect(assetClassToPseudoSector('CRYPTO')).toBe('Crypto');
  });
  it('fund asset classes (look-through failed) → Unclassified', () => {
    expect(assetClassToPseudoSector('US_TOTAL_MARKET')).toBe('Unclassified');
  });
});

describe('aggregateBySector', () => {
  it('sums per-ticker exposures by sector', () => {
    const map = buildSectorMap(tickers as any);
    const slices = aggregateBySector(exposures, map);
    const tech = slices.find((s) => s.name === 'Technology');
    const fin = slices.find((s) => s.name === 'Financials');
    const fi = slices.find((s) => s.name === 'Fixed Income');
    const unc = slices.find((s) => s.name === 'Unclassified');
    expect(tech!.value).toBe(18_000);
    expect(fin!.value).toBe(5_000);
    expect(fi!.value).toBe(4_000);
    expect(unc!.value).toBe(1_000);
  });
  it('clamps SHORT (negative) exposures to 0', () => {
    const map = buildSectorMap(tickers as any);
    const slices = aggregateBySector([{ ticker: 'AAPL', effectiveExposure: -500 }], map);
    expect(slices.find((s) => s.name === 'Technology')!.value).toBe(0);
  });
});

describe('aggregateByIndustry', () => {
  it('breaks down a single sector into industries', () => {
    const map = buildSectorMap(tickers as any);
    const slices = aggregateByIndustry(exposures, map, 'Technology');
    expect(slices.find((s) => s.name === 'Tech Hardware')!.value).toBe(10_000);
    expect(slices.find((s) => s.name === 'Software')!.value).toBe(8_000);
  });
  it('groups tickers with null industry under "Unclassified"', () => {
    const map = buildSectorMap(tickers as any);
    const ex = [{ ticker: 'JPM', effectiveExposure: 5_000 }];
    const tweaked = [...tickers]; tweaked[2] = { ...tweaked[2], industry: null };
    const slices = aggregateByIndustry(ex, buildSectorMap(tweaked as any), 'Financials');
    expect(slices[0]).toEqual({ name: 'Unclassified', value: 5_000 });
  });
});
