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
    // Zero-exposure tickers are dropped from the result; nothing should claim Technology.
    expect(slices.find((s) => s.name === 'Technology')).toBeUndefined();
  });
});

describe('aggregateBySector with fund sector weights', () => {
  it('distributes a fund exposure across its sector weightings', () => {
    const map = buildSectorMap(tickers as any);
    // VTI is a US_TOTAL_MARKET fund — without weights it would lump into
    // 'Unclassified' (the pseudo-sector for US_TOTAL_MARKET). With weights,
    // its $10,000 exposure should distribute proportionally.
    const fundWeights = new Map([
      ['VTI', [
        { sector: 'Technology', weight: 0.30 },
        { sector: 'Financials', weight: 0.20 },
        { sector: 'Healthcare', weight: 0.50 },
      ]],
    ]);
    const slices = aggregateBySector(
      [{ ticker: 'VTI', effectiveExposure: 10_000 }],
      map,
      fundWeights,
    );
    expect(slices.find((s) => s.name === 'Technology')!.value).toBeCloseTo(3_000, 6);
    expect(slices.find((s) => s.name === 'Financials')!.value).toBeCloseTo(2_000, 6);
    expect(slices.find((s) => s.name === 'Healthcare')!.value).toBeCloseTo(5_000, 6);
    // No Unclassified leftover when weights sum to 1.0.
    expect(slices.find((s) => s.name === 'Unclassified')).toBeUndefined();
  });

  it('attributes uncovered residual to the fund pseudo-sector when weights sum to < 1', () => {
    const map = buildSectorMap(tickers as any);
    // VTI's pseudo-sector falls back to 'Unclassified'. A partial breakdown
    // covering only 70% leaves 30% for that fallback.
    const fundWeights = new Map([
      ['VTI', [
        { sector: 'Technology', weight: 0.50 },
        { sector: 'Financials', weight: 0.20 },
      ]],
    ]);
    const slices = aggregateBySector(
      [{ ticker: 'VTI', effectiveExposure: 10_000 }],
      map,
      fundWeights,
    );
    expect(slices.find((s) => s.name === 'Technology')!.value).toBeCloseTo(5_000, 6);
    expect(slices.find((s) => s.name === 'Financials')!.value).toBeCloseTo(2_000, 6);
    expect(slices.find((s) => s.name === 'Unclassified')!.value).toBeCloseTo(3_000, 6);
  });

  it('combines fund-distributed exposure with direct-equity exposure into shared sectors', () => {
    const map = buildSectorMap(tickers as any);
    const fundWeights = new Map([
      ['VTI', [{ sector: 'Technology', weight: 1.0 }]],
    ]);
    const ex = [
      { ticker: 'AAPL', effectiveExposure: 10_000 }, // direct Technology
      { ticker: 'VTI', effectiveExposure: 5_000 },   // fund → 100% Technology
    ];
    const slices = aggregateBySector(ex, map, fundWeights);
    expect(slices.find((s) => s.name === 'Technology')!.value).toBeCloseTo(15_000, 6);
  });

  it('falls back to default behavior when a ticker has no weights entry', () => {
    const map = buildSectorMap(tickers as any);
    const fundWeights = new Map<string, { sector: string; weight: number }[]>();
    // Only VTI gets fund weights; AAPL still uses the sectorMap path.
    fundWeights.set('VTI', [{ sector: 'Technology', weight: 1.0 }]);
    const slices = aggregateBySector(exposures, map, fundWeights);
    // AAPL contributes 10k Technology + VTI contributes 0 (not in exposures);
    // none of the other tickers have fund weights so they keep the original behavior.
    const tech = slices.find((s) => s.name === 'Technology');
    expect(tech!.value).toBe(18_000); // unchanged: same as test 1 above
  });

  it('treats an empty weights array the same as no entry', () => {
    const map = buildSectorMap(tickers as any);
    // Bond ETFs typically return all-zero weights, which the YahooClient
    // drops to empty. Empty weights should fall back to sectorMap entry.
    const fundWeights = new Map([['BND', []]]);
    const slices = aggregateBySector(
      [{ ticker: 'BND', effectiveExposure: 4_000 }],
      map,
      fundWeights,
    );
    expect(slices.find((s) => s.name === 'Fixed Income')!.value).toBe(4_000);
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
