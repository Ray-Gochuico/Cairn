import { describe, it, expect } from 'vitest';
import { computeConcentration } from '@/lib/concentration';

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
});
