import { useCallback, useMemo } from 'react';
import DonutChartCard, { type DonutSlice } from './DonutChartCard';
import { DonutEntityPicker, useDonutSelected, type DonutEntityPickerItem } from './DonutEntityPicker';
import { CHART_NEUTRAL } from './palette';
import { colorForTicker } from '@/lib/chart-colors';
import { withMiscLast } from '@/lib/concentration';
import { useConcentration } from '@/lib/use-concentration';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { formatCurrency } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AssetClass } from '@/types/schema';

// Module-level empty-data sentinel so the empty-state donut passes the
// same `data` reference every render — recharts' Pie regenerates its
// animation id on each new props object, and an inline `[]` would
// re-animate on every parent re-render.
const EMPTY_DONUT_DATA: DonutSlice[] = [];
const STORAGE_KEY = 'donut.perTicker.hidden';

/**
 * Per-company effective exposure donut with top-10 + Misc rollup.
 * Sits alongside the asset-class allocation donut on Investments —
 * the asset-class view shows "what categories you're in"; this view
 * shows "what individual companies you're exposed to" after fund
 * look-through. SHORT-direction holdings produce negative
 * effectiveExposure; we clamp to non-negative so the donut renders
 * meaningfully (SHORT-aware viz is Phase 5+).
 *
 * Picker: a header popover lets the user hide individual tickers; the
 * hidden set persists in localStorage under `donut.perTicker.hidden`.
 * Keys are ticker symbol strings (already unique by definition).
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
  const fundHoldings = useFundHoldingsStore((s) => s.fundHoldings);
  const tickerColorMap = useMemo(
    () => new Map(tickers.map((t) => [t.ticker, t.accentColor])),
    [tickers],
  );

  // Company name per ticker for the legend + tooltip. Most slices are
  // fund look-through underlyings (NVDA, ASML.AS, ...) that aren't in the
  // local tickers table, so their only name source is Yahoo's holdingName
  // captured on fund_holdings. Directly-held tickers (in the tickers store)
  // take precedence; otherwise we fall back to the underlying name. The map
  // only holds entries where a non-empty name actually exists, so the
  // formatters can treat "missing" as "render the bare ticker".
  const nameByTicker = useMemo(() => {
    const map = new Map<string, string>();
    // Underlyings first (lower precedence) so a directly-held name overwrites.
    for (const fh of fundHoldings) {
      if (fh.holdingName && !map.has(fh.holdingTicker)) {
        map.set(fh.holdingTicker, fh.holdingName);
      }
    }
    for (const t of tickers) {
      if (t.name) map.set(t.ticker, t.name);
    }
    return map;
  }, [tickers, fundHoldings]);

  // Tooltip keeps the existing "TICKER — Company" format but now sources
  // names from the combined map, so look-through underlyings get names too.
  const tooltipNameFormatter = useCallback(
    (name: string) => {
      const companyName = nameByTicker.get(name);
      return companyName ? `${name} — ${companyName}` : name;
    },
    [nameByTicker],
  );

  // Legend shows "Company Name (TICKER)" when we have a name, else the bare
  // ticker. The "Misc" rollup has no name → stays "Misc" (no parens).
  const legendLabelFormatter = useCallback(
    (name: string) => {
      const companyName = nameByTicker.get(name);
      return companyName ? `${companyName} (${name})` : name;
    },
    [nameByTicker],
  );

  // Memoise the slices and opaque-funds derivations on report.perTicker /
  // tickerColorMap so the `data` array passed to <DonutChartCard> keeps a
  // stable reference across re-renders. Without this, every Investments-page
  // render produces a fresh array, which churns recharts' Pie animation
  // (it keys its <JavascriptAnimate> off a reference-equality animationId)
  // and contributed to the page-level Maximum-update-depth crash.
  const slices = useMemo(
    () =>
      withMiscLast(report.perTicker).map((s) => ({
        name: s.ticker,
        // Donut can't render negative wedges; SHORT exposures get clamped here.
        value: Math.max(0, s.effectiveExposure),
        color:
          s.ticker === 'Misc'
            ? CHART_NEUTRAL
            : colorForTicker(s.ticker, tickerColorMap.get(s.ticker)),
      })),
    [report.perTicker, tickerColorMap],
  );

  // Picker items mirror slices 1:1 — ticker symbol is the picker key.
  const pickerItems = useMemo<DonutEntityPickerItem[]>(
    () =>
      slices.map((s) => ({
        key: s.name,
        label: s.name,
        color: s.color,
      })),
    [slices],
  );
  const allKeys = useMemo(() => pickerItems.map((i) => i.key), [pickerItems]);
  const selected = useDonutSelected(STORAGE_KEY, allKeys);
  const filteredSlices = useMemo(
    () => slices.filter((s) => selected.has(s.name)),
    [slices, selected],
  );
  // Full-universe denominator (hidden slices included) so hiding a ticker
  // never re-normalizes the shares that remain (protected-visibility rule).
  const fullTotal = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices]);

  // Identify wedges whose ticker is itself classified as a fund — these are
  // funds whose look-through failed (concentration's math falls back to
  // "opaque holding" and credits the fund's ticker directly). Surfacing
  // them tells the user why they're seeing VTI/FXAIX instead of AAPL/MSFT.
  const opaqueFunds = useMemo(
    () =>
      report.perTicker
        .filter((t) => {
          const cls = tickerClassMap.get(t.ticker);
          return cls !== undefined && FUND_ASSET_CLASSES.has(cls);
        })
        .map((t) => t.ticker),
    [report.perTicker, tickerClassMap],
  );

  const hasData = slices.some((s) => s.value > 0);

  if (!hasData) {
    return (
      <DonutChartCard
        title="Per-company exposure"
        subtitle="After fund look-through"
        data={EMPTY_DONUT_DATA}
      />
    );
  }

  const subtitle = opaqueFunds.length > 0
    ? `After fund look-through · ${opaqueFunds.join(', ')} couldn't be looked through (Data health → Refresh fund data)`
    : 'After fund look-through';

  const picker = (
    <DonutEntityPicker localStorageKey={STORAGE_KEY} items={pickerItems} />
  );

  // All entities hidden — keep the picker visible so the user can re-show.
  if (filteredSlices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Per-company exposure</CardTitle>
            {picker}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            All entities hidden. Open the picker above to show at least one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <DonutChartCard
      title="Per-company exposure"
      subtitle={subtitle}
      data={filteredSlices}
      shareTotal={fullTotal}
      valueFormatter={formatCurrency}
      tooltipNameFormatter={tooltipNameFormatter}
      legendLabelFormatter={legendLabelFormatter}
      headerRight={picker}
    />
  );
}

export default PerTickerDonut;
