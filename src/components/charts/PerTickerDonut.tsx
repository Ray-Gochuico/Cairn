import { useCallback, useMemo } from 'react';
import DonutChartCard from './DonutChartCard';
import { topNWithMisc } from '@/lib/concentration';
import { useConcentration } from '@/lib/use-concentration';
import { useTickersStore } from '@/stores/tickers-store';
import { formatCurrency } from '@/lib/format';
import type { AssetClass } from '@/types/schema';

/**
 * Per-company effective exposure donut with top-10 + Misc rollup.
 * Sits alongside the asset-class allocation donut on Investments —
 * the asset-class view shows "what categories you're in"; this view
 * shows "what individual companies you're exposed to" after fund
 * look-through. SHORT-direction holdings produce negative
 * effectiveExposure; we clamp to non-negative so the donut renders
 * meaningfully (SHORT-aware viz is Phase 5+).
 */

// Asset classes that imply a fund (and therefore expect look-through
// into the underlying companies). When a wedge's ticker still resolves
// to one of these classes, look-through didn't happen for that fund —
// almost always because fund_holdings has no rows for it (Yahoo returned
// empty, sync hasn't run yet, etc). Mirrors the same constant in
// fund-holdings-sync.ts and concentration.ts.
const FUND_ASSET_CLASSES = new Set<AssetClass>([
  'US_TOTAL_MARKET', 'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
  'INTL_DEVELOPED', 'EMERGING_MARKETS', 'US_BONDS', 'INTL_BONDS', 'TIPS',
  'REAL_ESTATE', 'COMMODITIES',
]);

export function PerTickerDonut() {
  const report = useConcentration();
  const tickers = useTickersStore((s) => s.tickers);
  const tickerClassMap = useMemo(
    () => new Map(tickers.map((t) => [t.ticker, t.assetClass])),
    [tickers],
  );
  const tickerNameMap = useMemo(
    () => new Map(tickers.map((t) => [t.ticker, t.name])),
    [tickers],
  );

  const tooltipNameFormatter = useCallback(
    (name: string) => {
      const companyName = tickerNameMap.get(name);
      return companyName ? `${name} — ${companyName}` : name;
    },
    [tickerNameMap],
  );

  const slices = topNWithMisc(report.perTicker, 10).map((s) => ({
    name: s.ticker,
    // Donut can't render negative wedges; SHORT exposures get clamped here.
    value: Math.max(0, s.effectiveExposure),
  }));

  // Identify wedges whose ticker is itself classified as a fund — these are
  // funds whose look-through failed (concentration's math falls back to
  // "opaque holding" and credits the fund's ticker directly). Surfacing
  // them tells the user why they're seeing VTI/FXAIX instead of AAPL/MSFT.
  const opaqueFunds = report.perTicker
    .filter((t) => {
      const cls = tickerClassMap.get(t.ticker);
      return cls !== undefined && FUND_ASSET_CLASSES.has(cls);
    })
    .map((t) => t.ticker);

  const hasData = slices.some((s) => s.value > 0);

  if (!hasData) {
    return (
      <DonutChartCard
        title="Per-company exposure"
        subtitle="After fund look-through"
        data={[]}
      />
    );
  }

  const subtitle = opaqueFunds.length > 0
    ? `Top 10 + Misc · ${opaqueFunds.join(', ')} couldn't be looked through (click "Refresh fund data")`
    : 'Top 10 + Misc, after fund look-through';

  return (
    <DonutChartCard
      title="Per-company exposure"
      subtitle={subtitle}
      data={slices}
      valueFormatter={formatCurrency}
      tooltipNameFormatter={tooltipNameFormatter}
    />
  );
}

export default PerTickerDonut;
