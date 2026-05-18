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
  const assetClassExposure = new Map<AssetClass, number>();
  let absLeverageSum = 0;

  for (const h of input.holdings) {
    const meta = input.tickers.get(h.ticker);
    const assetClass = meta?.assetClass ?? 'OTHER';
    const leverage = meta?.leverageFactor ?? 1;
    const sign = meta?.direction === 'SHORT' ? -1 : 1;
    const isFund = FUND_ASSET_CLASSES.has(assetClass);
    const fundRows = isFund ? input.fundHoldings.get(h.ticker) : undefined;

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
  const perAssetClass = [...assetClassExposure].map(([assetClass, effectiveExposure]) => ({
    assetClass,
    effectiveExposure,
    pctOfPortfolio: effectiveExposure / portfolio,
  })).sort((a, b) => b.pctOfPortfolio - a.pctOfPortfolio);

  const totalLeverage = absLeverageSum / portfolio;

  const warnings: ConcentrationWarning[] = [];
  for (const t of perTicker) {
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

  return { perTicker, perAssetClass, totalLeverage, warnings };
}

/**
 * Collapse a sorted-descending perTicker list into top-N named tickers
 * + a single "Misc" bucket. Misc never occupies one of the N slots — it
 * always appears as the (N+1)th wedge when there's anything to aggregate.
 *
 * Aggregation rules:
 *   - The tail of named tickers (anything ranked beyond top-N) goes into Misc.
 *   - Any pre-existing 'Misc' entry from `computeConcentration` (fund tails)
 *     also gets folded into the single final Misc wedge.
 *   - If named.length ≤ N AND no pre-existing Misc, no Misc wedge is added.
 *
 * Assumes input is already sorted descending by pctOfPortfolio (which is
 * the shape `computeConcentration().perTicker` returns).
 */
export function topNWithMisc(
  perTicker: Array<{ ticker: string; effectiveExposure: number; pctOfPortfolio: number }>,
  n: number,
): Array<{ ticker: string; effectiveExposure: number; pctOfPortfolio: number }> {
  const named = perTicker.filter((s) => s.ticker !== 'Misc');
  const existingMisc = perTicker.filter((s) => s.ticker === 'Misc');

  const head = named.slice(0, n);
  const tail = named.slice(n);

  const allForMisc = [...tail, ...existingMisc];
  if (allForMisc.length === 0) return head;

  const miscExposure = allForMisc.reduce((a, b) => a + b.effectiveExposure, 0);
  const miscPct = allForMisc.reduce((a, b) => a + b.pctOfPortfolio, 0);
  return [...head, { ticker: 'Misc', effectiveExposure: miscExposure, pctOfPortfolio: miscPct }];
}
