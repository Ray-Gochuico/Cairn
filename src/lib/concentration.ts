import type { AssetClass, Direction } from '@/types/schema';

export interface ConcentrationInput {
  holdings: { ticker: string; value: number }[];
  tickers: Map<string, { assetClass: AssetClass; leverageFactor: number; direction: Direction }>;
  fundHoldings: Map<string, { symbol: string; weight: number }[]>;
  totalPortfolioValue: number;
}

export interface ConcentrationWarning {
  type: 'PER_TICKER_HIGH' | 'PER_TICKER_SOFT' | 'PER_ASSET_CLASS_HIGH' | 'PER_ASSET_CLASS_SOFT' | 'LEVERAGE_HIGH';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  ticker?: string;
  assetClass?: AssetClass;
  exposurePct: number;
}

export interface ConcentrationReport {
  perTicker: { ticker: string; effectiveExposure: number; pctOfPortfolio: number }[];
  /**
   * Pre-look-through per-ticker exposure: each holding contributes to its own
   * ticker (fund tickers are NOT replaced by their underlying top-N + Misc).
   * Same leverage/direction math as perTicker, but funds stay intact so the
   * sector donut can distribute each fund across its fund_sectors weights.
   *
   * Use this for any per-ticker view that needs to keep fund identity (sector
   * breakdown, asset-class allocation, raw holdings views). Use perTicker for
   * any view that wants effective exposure to individual companies after fund
   * look-through (per-company donut, concentration warnings).
   */
  tickerExposures: { ticker: string; effectiveExposure: number }[];
  perAssetClass: { assetClass: AssetClass; effectiveExposure: number; pctOfPortfolio: number }[];
  totalLeverage: number;
  warnings: ConcentrationWarning[];
}

const FUND_ASSET_CLASSES = new Set<AssetClass>([
  'US_TOTAL_MARKET', 'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
  'INTL_DEVELOPED', 'EMERGING_MARKETS', 'US_BONDS', 'INTL_BONDS', 'TIPS',
  'REAL_ESTATE', 'COMMODITIES',
]);

export function computeConcentration(input: ConcentrationInput): ConcentrationReport {
  const tickerExposure = new Map<string, number>();
  const rawTickerExposure = new Map<string, number>();
  const assetClassExposure = new Map<AssetClass, number>();
  let absLeverageSum = 0;

  for (const h of input.holdings) {
    const meta = input.tickers.get(h.ticker);
    const assetClass = meta?.assetClass ?? 'OTHER';
    const leverage = meta?.leverageFactor ?? 1;
    const sign = meta?.direction === 'SHORT' ? -1 : 1;
    const isFund = FUND_ASSET_CLASSES.has(assetClass);
    const fundRows = isFund ? input.fundHoldings.get(h.ticker) : undefined;
    // Always accumulate the raw (pre-look-through) per-ticker exposure so the
    // sector donut sees the fund ticker itself rather than its top-N
    // underlyings. Same leverage/direction math as the post-look-through
    // pass below.
    rawTickerExposure.set(
      h.ticker,
      (rawTickerExposure.get(h.ticker) ?? 0) + h.value * leverage * sign,
    );

    if (fundRows && fundRows.length > 0) {
      let totalCovered = 0;
      for (const f of fundRows) {
        const contribution = h.value * f.weight * leverage * sign;
        tickerExposure.set(f.symbol, (tickerExposure.get(f.symbol) ?? 0) + contribution);
        const underlyingMeta = input.tickers.get(f.symbol);
        const underlyingClass = underlyingMeta?.assetClass ?? 'OTHER';
        assetClassExposure.set(underlyingClass, (assetClassExposure.get(underlyingClass) ?? 0) + Math.abs(contribution));
        totalCovered += f.weight;
      }
      // The fund's top-N weights typically sum to less than 1.0 (Yahoo returns
      // only top-10). Attribute the remaining (1 - totalCovered) to a shared
      // 'Misc' ticker so the per-company donut sums to 100% of the portfolio.
      // Asset-class exposure for the uncovered slice stays under the fund's
      // own class (a US_TOTAL_MARKET fund's untracked portion is still
      // US_TOTAL_MARKET).
      const uncovered = Math.max(0, 1 - totalCovered);
      if (uncovered > 0) {
        const miscContribution = h.value * uncovered * leverage * sign;
        tickerExposure.set('Misc', (tickerExposure.get('Misc') ?? 0) + miscContribution);
        assetClassExposure.set(assetClass, (assetClassExposure.get(assetClass) ?? 0) + Math.abs(miscContribution));
      }
      absLeverageSum += Math.abs(h.value * leverage);
    } else {
      const contribution = h.value * leverage * sign;
      tickerExposure.set(h.ticker, (tickerExposure.get(h.ticker) ?? 0) + contribution);
      assetClassExposure.set(assetClass, (assetClassExposure.get(assetClass) ?? 0) + Math.abs(contribution));
      absLeverageSum += Math.abs(h.value * leverage);
    }
  }

  const portfolio = input.totalPortfolioValue || 1;
  const perTicker = [...tickerExposure].map(([ticker, effectiveExposure]) => ({
    ticker,
    effectiveExposure,
    pctOfPortfolio: Math.abs(effectiveExposure) / portfolio,
  })).sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio);
  const tickerExposures = [...rawTickerExposure].map(([ticker, effectiveExposure]) => ({
    ticker,
    effectiveExposure,
  }));
  const perAssetClass = [...assetClassExposure].map(([assetClass, effectiveExposure]) => ({
    assetClass,
    effectiveExposure,
    pctOfPortfolio: effectiveExposure / portfolio,
  })).sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio);

  const totalLeverage = absLeverageSum / portfolio;

  const warnings: ConcentrationWarning[] = [];
  for (const t of perTicker) {
    // Misc is a synthetic catch-all for the untracked tail of fund top-N
    // weights — a large Misc share means little is known about the underlying,
    // not that a single name is concentrated. Skip it in the warnings list
    // while still leaving the row visible in normal breakdowns.
    if (t.ticker === 'Misc') continue;
    if (t.pctOfPortfolio > 0.25) warnings.push({
      type: 'PER_TICKER_HIGH', severity: 'HIGH', ticker: t.ticker,
      exposurePct: t.pctOfPortfolio,
      message: `${t.ticker} is ${(t.pctOfPortfolio * 100).toFixed(1)}% of effective exposure (>25%).`,
    });
    else if (t.pctOfPortfolio > 0.15) warnings.push({
      type: 'PER_TICKER_SOFT', severity: 'LOW', ticker: t.ticker,
      exposurePct: t.pctOfPortfolio,
      message: `${t.ticker} is ${(t.pctOfPortfolio * 100).toFixed(1)}% of effective exposure.`,
    });
  }
  for (const a of perAssetClass) {
    if (a.pctOfPortfolio > 0.60) warnings.push({
      type: 'PER_ASSET_CLASS_HIGH', severity: 'HIGH', assetClass: a.assetClass,
      exposurePct: a.pctOfPortfolio,
      message: `${a.assetClass} is ${(a.pctOfPortfolio * 100).toFixed(1)}% of portfolio (>60%).`,
    });
    else if (a.pctOfPortfolio > 0.50) warnings.push({
      type: 'PER_ASSET_CLASS_SOFT', severity: 'LOW', assetClass: a.assetClass,
      exposurePct: a.pctOfPortfolio,
      message: `${a.assetClass} is ${(a.pctOfPortfolio * 100).toFixed(1)}% of portfolio.`,
    });
  }
  if (totalLeverage > 1.5) warnings.push({
    type: 'LEVERAGE_HIGH', severity: 'MEDIUM', exposurePct: totalLeverage,
    message: `Total effective leverage is ${totalLeverage.toFixed(2)}x (>1.5x).`,
  });

  return { perTicker, tickerExposures, perAssetClass, totalLeverage, warnings };
}

/**
 * Reorder a perTicker list so the 'Misc' wedge appears last in the
 * donut visualization, regardless of its pctOfPortfolio rank. The
 * input is already sorted descending by pct (from `computeConcentration`),
 * which would otherwise put a large Misc bucket at the front; visually
 * Misc reads better as the catch-all wedge at the end.
 *
 * No truncation, no aggregation: every named ticker comes through
 * unchanged. Returns the input unchanged if no Misc entry is present.
 */
export function withMiscLast(
  perTicker: Array<{ ticker: string; effectiveExposure: number; pctOfPortfolio: number }>,
): Array<{ ticker: string; effectiveExposure: number; pctOfPortfolio: number }> {
  const misc = perTicker.find((s) => s.ticker === 'Misc');
  if (!misc) return perTicker;
  const named = perTicker.filter((s) => s.ticker !== 'Misc');
  return [...named, misc];
}

/**
 * Pick the top-N effective-exposure rows for the Concentration Health
 * summary, excluding the synthetic 'Misc' bucket. Misc represents the
 * untracked tail of fund top-N weights (i.e., a diversified residual),
 * so a large Misc share doesn't indicate concentration in any single
 * name and shouldn't crowd out real exposures in the headline list.
 *
 * Mirrors the warning-loop exclusion at the top of computeConcentration.
 * Skips zero-or-negative pct rows so a household with only Misc renders
 * an empty top-N list rather than a list of dead rows.
 *
 * Returns at most `n` rows (default 3) preserving the input's descending
 * pctOfPortfolio order.
 */
export function topEffectiveExposures(
  perTicker: Array<{ ticker: string; effectiveExposure: number; pctOfPortfolio: number }>,
  n = 3,
): Array<{ ticker: string; effectiveExposure: number; pctOfPortfolio: number }> {
  return perTicker
    .filter((t) => t.ticker !== 'Misc' && t.pctOfPortfolio > 0)
    .slice(0, n);
}
