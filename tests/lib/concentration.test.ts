import { describe, it, expect } from 'vitest';
import { computeConcentration, withMiscLast, topEffectiveExposures } from '@/lib/concentration';

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

  it('does NOT emit per-ticker warnings for the Misc bucket even when it exceeds 25%', () => {
    // A VTI-heavy portfolio where Yahoo only returned 1 top holding (5%) leaves
    // 95% of the portfolio attributed to "Misc". Without the guard, Misc would
    // fire a PER_TICKER_HIGH warning — but Misc is a synthetic catch-all, not
    // a real concentration risk. Misc still appears in normal perTicker
    // breakdowns; only the warnings list filters it.
    const result = computeConcentration({
      holdings: [{ ticker: 'VTI', value: 100_000 }],
      tickers: new Map([
        ['VTI', { assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG' }],
        ['AAPL', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
      ]),
      fundHoldings: new Map([['VTI', [{ symbol: 'AAPL', weight: 0.05 }]]]),
      totalPortfolioValue: 100_000,
    });
    const misc = result.perTicker.find((t) => t.ticker === 'Misc');
    expect(misc).toBeDefined();
    expect(misc!.pctOfPortfolio).toBeGreaterThan(0.25);
    // Misc must not show up as any per-ticker warning
    expect(result.warnings.some((w) => w.ticker === 'Misc')).toBe(false);
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

  describe('tickerExposures (pre-look-through)', () => {
    // Used by the sector donut: report.perTicker is fund-look-through and
    // replaces VTI with its top-N underlyings + Misc, which makes
    // aggregateBySector unable to look up VTI's sectorWeightings. The
    // tickerExposures field keeps the fund ticker intact so the sector
    // distribution can fire.

    it('keeps the fund ticker intact (no top-10 explosion)', () => {
      const result = computeConcentration({
        holdings: [{ ticker: 'VTI', value: 10000 }],
        tickers: new Map([
          ['VTI', { assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG' }],
        ]),
        fundHoldings: new Map([['VTI', [
          { symbol: 'AAPL', weight: 0.08 },
          { symbol: 'MSFT', weight: 0.07 },
        ]]]),
        totalPortfolioValue: 10000,
      });
      // perTicker (post-look-through) explodes into AAPL/MSFT/Misc
      expect(result.perTicker.find((t) => t.ticker === 'VTI')).toBeUndefined();
      expect(result.perTicker.find((t) => t.ticker === 'AAPL')).toBeDefined();
      // tickerExposures (pre-look-through) keeps the fund ticker
      expect(result.tickerExposures.find((t) => t.ticker === 'VTI')).toBeDefined();
      expect(result.tickerExposures.find((t) => t.ticker === 'AAPL')).toBeUndefined();
      expect(result.tickerExposures.find((t) => t.ticker === 'Misc')).toBeUndefined();
    });

    it('applies leverage and direction in the same way as perTicker', () => {
      const result = computeConcentration({
        holdings: [{ ticker: 'TQQQ', value: 10000 }],
        tickers: new Map([
          ['TQQQ', { assetClass: 'US_LARGE_CAP', leverageFactor: 3, direction: 'SHORT' }],
        ]),
        fundHoldings: new Map(),
        totalPortfolioValue: 10000,
      });
      const tqqq = result.tickerExposures.find((t) => t.ticker === 'TQQQ')!;
      // value * leverage * sign(SHORT=-1) = 10000 * 3 * -1 = -30000
      expect(tqqq.effectiveExposure).toBeCloseTo(-30000, 4);
    });

    it('sums multiple holdings of the same ticker (across accounts)', () => {
      const result = computeConcentration({
        holdings: [
          { ticker: 'VTI', value: 6000 },
          { ticker: 'VTI', value: 4000 },
        ],
        tickers: new Map([
          ['VTI', { assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG' }],
        ]),
        fundHoldings: new Map(),
        totalPortfolioValue: 10000,
      });
      const vti = result.tickerExposures.find((t) => t.ticker === 'VTI')!;
      expect(vti.effectiveExposure).toBeCloseTo(10000, 4);
    });

    it('mixes funds and single stocks correctly', () => {
      const result = computeConcentration({
        holdings: [
          { ticker: 'VTI', value: 10000 },
          { ticker: 'NVDA', value: 5000 },
        ],
        tickers: new Map([
          ['VTI', { assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG' }],
          ['NVDA', { assetClass: 'SINGLE_STOCK', leverageFactor: 1, direction: 'LONG' }],
        ]),
        fundHoldings: new Map([['VTI', [{ symbol: 'NVDA', weight: 0.05 }]]]),
        totalPortfolioValue: 15000,
      });
      // tickerExposures has the raw holdings; both tickers appear without merge.
      const vti = result.tickerExposures.find((t) => t.ticker === 'VTI')!;
      const nvda = result.tickerExposures.find((t) => t.ticker === 'NVDA')!;
      expect(vti.effectiveExposure).toBeCloseTo(10000, 4);
      expect(nvda.effectiveExposure).toBeCloseTo(5000, 4);
      // perTicker (post-look-through) double-counts NVDA via the fund weight
      // plus the direct holding, but that's a different field.
      const nvdaPost = result.perTicker.find((t) => t.ticker === 'NVDA')!;
      expect(nvdaPost.effectiveExposure).toBeCloseTo(5000 + 10000 * 0.05, 4);
    });
  });
});

describe('withMiscLast', () => {
  it('returns input unchanged when no Misc entry exists', () => {
    const input = [
      { ticker: 'AAPL', effectiveExposure: 1000, pctOfPortfolio: 0.5 },
      { ticker: 'MSFT', effectiveExposure: 800, pctOfPortfolio: 0.4 },
    ];
    expect(withMiscLast(input)).toEqual(input);
  });

  it('moves Misc to the end when it ranks first', () => {
    const input = [
      { ticker: 'Misc', effectiveExposure: 5000, pctOfPortfolio: 0.5 },
      { ticker: 'AAPL', effectiveExposure: 3000, pctOfPortfolio: 0.3 },
      { ticker: 'MSFT', effectiveExposure: 2000, pctOfPortfolio: 0.2 },
    ];
    const result = withMiscLast(input);
    expect(result.map((r) => r.ticker)).toEqual(['AAPL', 'MSFT', 'Misc']);
  });

  it('preserves named ticker order (already sorted desc by pct)', () => {
    const input = [
      { ticker: 'A', effectiveExposure: 50, pctOfPortfolio: 0.5 },
      { ticker: 'Misc', effectiveExposure: 30, pctOfPortfolio: 0.3 },
      { ticker: 'B', effectiveExposure: 15, pctOfPortfolio: 0.15 },
      { ticker: 'C', effectiveExposure: 5, pctOfPortfolio: 0.05 },
    ];
    const result = withMiscLast(input);
    expect(result.map((r) => r.ticker)).toEqual(['A', 'B', 'C', 'Misc']);
  });

  it('does not truncate even with very long named lists', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      ticker: `T${i}`, effectiveExposure: 100, pctOfPortfolio: 0.02,
    }));
    expect(withMiscLast(items)).toHaveLength(50);
  });
});

describe('topEffectiveExposures', () => {
  it('excludes Misc even when it is the largest exposure', () => {
    const input = [
      { ticker: 'Misc', effectiveExposure: 6530, pctOfPortfolio: 0.653 },
      { ticker: 'NVDA', effectiveExposure: 700,  pctOfPortfolio: 0.07 },
      { ticker: 'AAPL', effectiveExposure: 600,  pctOfPortfolio: 0.06 },
      { ticker: 'MSFT', effectiveExposure: 500,  pctOfPortfolio: 0.05 },
    ];
    const top = topEffectiveExposures(input, 3);
    expect(top.map((t) => t.ticker)).toEqual(['NVDA', 'AAPL', 'MSFT']);
  });

  it('returns at most N rows', () => {
    const input = Array.from({ length: 20 }, (_, i) => ({
      ticker: `T${i}`,
      effectiveExposure: 100 - i,
      pctOfPortfolio: (100 - i) / 1000,
    }));
    expect(topEffectiveExposures(input, 3)).toHaveLength(3);
    expect(topEffectiveExposures(input, 5)).toHaveLength(5);
  });

  it('drops zero-or-negative pct rows', () => {
    const input = [
      { ticker: 'AAPL', effectiveExposure: 100, pctOfPortfolio: 0.5 },
      { ticker: 'ZERO', effectiveExposure: 0,   pctOfPortfolio: 0 },
      { ticker: 'NEG',  effectiveExposure: -50, pctOfPortfolio: -0.25 },
    ];
    expect(topEffectiveExposures(input, 5).map((t) => t.ticker)).toEqual(['AAPL']);
  });

  it('returns an empty list when only Misc has non-zero pct', () => {
    const input = [
      { ticker: 'Misc', effectiveExposure: 1000, pctOfPortfolio: 1.0 },
    ];
    expect(topEffectiveExposures(input)).toEqual([]);
  });

  it('preserves the input descending order among non-Misc rows', () => {
    const input = [
      { ticker: 'A', effectiveExposure: 80, pctOfPortfolio: 0.4 },
      { ticker: 'Misc', effectiveExposure: 60, pctOfPortfolio: 0.3 },
      { ticker: 'B', effectiveExposure: 40, pctOfPortfolio: 0.2 },
      { ticker: 'C', effectiveExposure: 20, pctOfPortfolio: 0.1 },
    ];
    expect(topEffectiveExposures(input, 3).map((t) => t.ticker)).toEqual(['A', 'B', 'C']);
  });
});
