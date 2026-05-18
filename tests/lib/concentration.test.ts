import { describe, it, expect } from 'vitest';
import { computeConcentration, topNWithMisc } from '@/lib/concentration';

describe('computeConcentration', () => {
  it('single stock contributes 100% to its own exposure', () => {
    const result = computeConcentration({
      holdings: [{ ticker: 'AAPL', value: 50000 }],
      tickers: new Map([['AAPL', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }]]),
      fundHoldings: new Map(),
      totalPortfolioValue: 100000,
    });
    const aapl = result.perTicker.find((t) => t.ticker === 'AAPL')!;
    expect(aapl.pctOfPortfolio).toBeCloseTo(0.5, 4);
  });

  it('fund holding looks through to underlying tickers', () => {
    const result = computeConcentration({
      holdings: [{ ticker: 'VOO', value: 100000 }],
      tickers: new Map([
        ['VOO', { assetClass: 'US_LARGE_CAP', leverageFactor: 1, direction: 'LONG' }],
        ['AAPL', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
      ]),
      fundHoldings: new Map([['VOO', [{ symbol: 'AAPL', weight: 0.08 }, { symbol: 'MSFT', weight: 0.07 }]]]),
      totalPortfolioValue: 100000,
    });
    const aapl = result.perTicker.find((t) => t.ticker === 'AAPL');
    expect(aapl?.effectiveExposure).toBeCloseTo(8000, 0);
  });

  it('leverage factor multiplies the exposure', () => {
    const result = computeConcentration({
      holdings: [{ ticker: 'TQQQ', value: 10000 }],
      tickers: new Map([['TQQQ', { assetClass: 'US_LARGE_CAP', leverageFactor: 3, direction: 'LONG' }]]),
      fundHoldings: new Map(),
      totalPortfolioValue: 10000,
    });
    expect(result.totalLeverage).toBeCloseTo(3, 2);
  });

  it('emits HIGH warning when single ticker exceeds 25%', () => {
    const result = computeConcentration({
      holdings: [{ ticker: 'AAPL', value: 30000 }, { ticker: 'BND', value: 70000 }],
      tickers: new Map([
        ['AAPL', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
        ['BND', { assetClass: 'US_BONDS', leverageFactor: 1, direction: 'LONG' }],
      ]),
      fundHoldings: new Map(),
      totalPortfolioValue: 100000,
    });
    const w = result.warnings.find((x) => x.type === 'PER_TICKER_HIGH');
    expect(w).toBeDefined();
    expect(w!.exposurePct).toBeGreaterThan(0.25);
  });

  it('emits HIGH warning when total leverage exceeds 1.5x', () => {
    const result = computeConcentration({
      holdings: [{ ticker: 'TQQQ', value: 100000 }],
      tickers: new Map([['TQQQ', { assetClass: 'US_LARGE_CAP', leverageFactor: 3, direction: 'LONG' }]]),
      fundHoldings: new Map(),
      totalPortfolioValue: 100000,
    });
    expect(result.totalLeverage).toBe(3);
    expect(result.warnings.some((w) => w.type === 'LEVERAGE_HIGH')).toBe(true);
  });

  it('treats unknown tickers as OTHER asset class', () => {
    const result = computeConcentration({
      holdings: [{ ticker: 'MEME', value: 10000 }],
      tickers: new Map(),
      fundHoldings: new Map(),
      totalPortfolioValue: 10000,
    });
    expect(result.perAssetClass.some((a) => a.assetClass === 'OTHER')).toBe(true);
  });

  // Additional sanity tests

  it('SHORT direction inverts ticker exposure sign but uses absolute value in asset-class aggregate', () => {
    const result = computeConcentration({
      holdings: [{ ticker: 'SQQQ', value: 20000 }],
      tickers: new Map([['SQQQ', { assetClass: 'US_LARGE_CAP', leverageFactor: 3, direction: 'SHORT' }]]),
      fundHoldings: new Map(),
      totalPortfolioValue: 20000,
    });
    const sqqq = result.perTicker.find((t) => t.ticker === 'SQQQ')!;
    expect(sqqq.effectiveExposure).toBeLessThan(0);
    // asset-class exposure uses abs value
    const ac = result.perAssetClass.find((a) => a.assetClass === 'US_LARGE_CAP')!;
    expect(ac.effectiveExposure).toBeGreaterThan(0);
  });

  it('fires PER_ASSET_CLASS_HIGH when all holdings are in the same asset class (>60%)', () => {
    const result = computeConcentration({
      holdings: [
        { ticker: 'AAPL', value: 70000 },
        { ticker: 'MSFT', value: 10000 },
      ],
      tickers: new Map([
        ['AAPL', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
        ['MSFT', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
      ]),
      fundHoldings: new Map(),
      totalPortfolioValue: 100000,
    });
    const w = result.warnings.find((x) => x.type === 'PER_ASSET_CLASS_HIGH');
    expect(w).toBeDefined();
    expect(w!.exposurePct).toBeGreaterThan(0.60);
  });

  it('fires PER_TICKER_SOFT between 15-25% and PER_ASSET_CLASS_SOFT between 50-60%', () => {
    // AAPL at 20% → PER_TICKER_SOFT; SINGLE_STOCK at 55% total → PER_ASSET_CLASS_SOFT
    const result = computeConcentration({
      holdings: [
        { ticker: 'AAPL', value: 20000 },
        { ticker: 'MSFT', value: 35000 },
        { ticker: 'BND', value: 45000 },
      ],
      tickers: new Map([
        ['AAPL', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
        ['MSFT', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
        ['BND', { assetClass: 'US_BONDS', leverageFactor: 1, direction: 'LONG' }],
      ]),
      fundHoldings: new Map(),
      totalPortfolioValue: 100000,
    });
    const tickerSoft = result.warnings.find((x) => x.type === 'PER_TICKER_SOFT' && x.ticker === 'AAPL');
    expect(tickerSoft).toBeDefined();
    expect(tickerSoft!.exposurePct).toBeGreaterThan(0.15);
    expect(tickerSoft!.exposurePct).toBeLessThanOrEqual(0.25);

    const acSoft = result.warnings.find((x) => x.type === 'PER_ASSET_CLASS_SOFT' && x.assetClass === 'SINGLE_STOCK');
    expect(acSoft).toBeDefined();
    expect(acSoft!.exposurePct).toBeGreaterThan(0.50);
    expect(acSoft!.exposurePct).toBeLessThanOrEqual(0.60);
  });

  it('attributes the fund tail to a shared Misc bucket when top-N covers < 100%', () => {
    const result = computeConcentration({
      holdings: [{ ticker: 'VTI', value: 10000 }],
      tickers: new Map([
        ['VTI', { assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG' }],
        ['AAPL', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
        ['MSFT', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
      ]),
      // Yahoo-style: top-2 sum to 0.15, the other 0.85 is untracked tail
      fundHoldings: new Map([['VTI', [
        { symbol: 'AAPL', weight: 0.08 },
        { symbol: 'MSFT', weight: 0.07 },
      ]]]),
      totalPortfolioValue: 10000,
    });
    const misc = result.perTicker.find((t) => t.ticker === 'Misc');
    expect(misc).toBeDefined();
    expect(misc!.effectiveExposure).toBeCloseTo(10000 * 0.85, 4);
    expect(misc!.pctOfPortfolio).toBeCloseTo(0.85, 4);

    // Sum of all per-ticker effective exposures should equal portfolio value
    const sum = result.perTicker.reduce((a, t) => a + Math.abs(t.effectiveExposure), 0);
    expect(sum).toBeCloseTo(10000, 1);
  });

  it('sums Misc across multiple funds into one shared bucket', () => {
    const result = computeConcentration({
      holdings: [
        { ticker: 'VTI', value: 10000 },
        { ticker: 'FXAIX', value: 5000 },
      ],
      tickers: new Map([
        ['VTI', { assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG' }],
        ['FXAIX', { assetClass: 'US_LARGE_CAP', leverageFactor: 1, direction: 'LONG' }],
      ]),
      fundHoldings: new Map([
        ['VTI', [{ symbol: 'AAPL', weight: 0.1 }]],   // 90% misc
        ['FXAIX', [{ symbol: 'AAPL', weight: 0.05 }]], // 95% misc
      ]),
      totalPortfolioValue: 15000,
    });
    const misc = result.perTicker.find((t) => t.ticker === 'Misc');
    // VTI: 10000 * 0.9 = 9000, FXAIX: 5000 * 0.95 = 4750, total 13750
    expect(misc!.effectiveExposure).toBeCloseTo(13750, 1);
  });

  it('does not create Misc when fund top-N sums to 1.0', () => {
    const result = computeConcentration({
      holdings: [{ ticker: 'VTI', value: 10000 }],
      tickers: new Map([
        ['VTI', { assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG' }],
      ]),
      fundHoldings: new Map([['VTI', [
        { symbol: 'AAPL', weight: 0.4 },
        { symbol: 'MSFT', weight: 0.6 },
      ]]]),
      totalPortfolioValue: 10000,
    });
    expect(result.perTicker.find((t) => t.ticker === 'Misc')).toBeUndefined();
  });
});

describe('topNWithMisc', () => {
  it('returns original list when length ≤ n', () => {
    const result = topNWithMisc(
      [
        { ticker: 'AAPL', effectiveExposure: 1000, pctOfPortfolio: 0.5 },
        { ticker: 'MSFT', effectiveExposure: 1000, pctOfPortfolio: 0.5 },
      ],
      10,
    );
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.ticker === 'Misc')).toBeUndefined();
  });

  it('aggregates the tail into a Misc bucket when length > n', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      ticker: `T${i}`, effectiveExposure: 100, pctOfPortfolio: 0.066,
    }));
    const result = topNWithMisc(items, 10);
    expect(result).toHaveLength(11);
    expect(result[10].ticker).toBe('Misc');
    expect(result[10].effectiveExposure).toBeCloseTo(500, 4);
    expect(result[10].pctOfPortfolio).toBeCloseTo(0.066 * 5, 4);
  });

  it('preserves the top-N order from the input list', () => {
    const items = [
      { ticker: 'A', effectiveExposure: 50, pctOfPortfolio: 0.5 },
      { ticker: 'B', effectiveExposure: 30, pctOfPortfolio: 0.3 },
      { ticker: 'C', effectiveExposure: 15, pctOfPortfolio: 0.15 },
      { ticker: 'D', effectiveExposure: 5, pctOfPortfolio: 0.05 },
    ];
    const result = topNWithMisc(items, 2);
    expect(result.map((r) => r.ticker)).toEqual(['A', 'B', 'Misc']);
    expect(result[2].effectiveExposure).toBeCloseTo(20, 4);
  });

  it('always reserves the Misc slot for non-Misc top-N, merging existing Misc with tail', () => {
    const result = topNWithMisc(
      [
        { ticker: 'A', effectiveExposure: 50, pctOfPortfolio: 0.5 },
        { ticker: 'Misc', effectiveExposure: 30, pctOfPortfolio: 0.3 },
        { ticker: 'B', effectiveExposure: 15, pctOfPortfolio: 0.15 },
        { ticker: 'C', effectiveExposure: 5, pctOfPortfolio: 0.05 },
      ],
      2,
    );
    // Top-2 NAMED = [A, B]. Misc bucket = existing 30 + tail (C) 5 = 35.
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.ticker)).toEqual(['A', 'B', 'Misc']);
    expect(result.find((r) => r.ticker === 'Misc')!.effectiveExposure).toBeCloseTo(35, 4);
    expect(result.find((r) => r.ticker === 'Misc')!.pctOfPortfolio).toBeCloseTo(0.35, 4);
  });

  it('shows N=10 named tickers + Misc when a giant Misc bucket would have ranked first', () => {
    // Realistic shape: 12 small individual companies + 1 huge Misc (from fund tails).
    // With the old buggy behavior, Misc would land in top-10 and bump one company.
    const items = [
      { ticker: 'Misc', effectiveExposure: 50000, pctOfPortfolio: 0.50 },
      ...Array.from({ length: 12 }, (_, i) => ({
        ticker: `T${i}`,
        effectiveExposure: 3000,
        pctOfPortfolio: 0.03,
      })),
    ];
    const result = topNWithMisc(items, 10);
    expect(result).toHaveLength(11);
    // First 10 wedges are all named (T0..T9), Misc is last.
    expect(result.slice(0, 10).every((r) => r.ticker.startsWith('T'))).toBe(true);
    expect(result[10].ticker).toBe('Misc');
    // Misc bucket = existing 50000 + tail (T10, T11) = 50000 + 6000 = 56000.
    expect(result[10].effectiveExposure).toBeCloseTo(56000, 1);
  });

  it('omits Misc when named.length ≤ N and no pre-existing Misc', () => {
    const result = topNWithMisc(
      [
        { ticker: 'A', effectiveExposure: 60, pctOfPortfolio: 0.6 },
        { ticker: 'B', effectiveExposure: 40, pctOfPortfolio: 0.4 },
      ],
      10,
    );
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.ticker === 'Misc')).toBeUndefined();
  });
});
