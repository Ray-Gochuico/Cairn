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
      for (const f of fundRows) {
        const contribution = h.value * f.weight * leverage * sign;
        tickerExposure.set(f.symbol, (tickerExposure.get(f.symbol) ?? 0) + contribution);
        const underlyingMeta = input.tickers.get(f.symbol);
        const underlyingClass = underlyingMeta?.assetClass ?? 'OTHER';
        assetClassExposure.set(underlyingClass, (assetClassExposure.get(underlyingClass) ?? 0) + Math.abs(contribution));
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
