import { shadeHexColor } from '@/lib/color';

/**
 * Default chart palette. Positions 0–9 are Vega category10 (Tableau-
 * derived) — picked for chart-specific aesthetic and distinguishability.
 * Positions 10–19 are lighter pair counterparts from Vega's tableau20
 * scheme, hue-matched to the first 10. Used by all chart primitives
 * (DonutChartCard, LineChartCard, BarChartCard) and the
 * InvestmentTimeSeriesChart per-account stack.
 *
 * Charts with ≤10 categories look identical to the prior 10-color
 * palette. Charts with 11–20 categories get distinct lighter colors
 * instead of modulo-wrapping back to color 0.
 *
 * Consumers that want explicit per-slice or per-series colors should
 * pass them via the slice/series `color` field; this palette is only
 * used as a default when no explicit color is supplied.
 *
 * The Phase 5 user color picker offers these 20 colors first, then the
 * 10 legacy Tailwind-600 hexes (LEGACY_TAILWIND_PALETTE below) as a
 * secondary set — SWATCH_OPTIONS is the combined 30-swatch list the
 * ColorSwatchPicker renders.
 */
export const CHART_PALETTE = [
  // Positions 0–9 — Vega category10 (unchanged)
  '#4c78a8',  // blue
  '#f58518',  // orange
  '#e45756',  // red
  '#72b7b2',  // teal
  '#54a24b',  // green
  '#eeca3b',  // yellow
  '#b279a2',  // purple
  '#ff9da6',  // pink
  '#9d755d',  // brown
  '#bab0ac',  // gray
  // Positions 10–19 — lighter Vega tableau20 pair counterparts
  '#9ecae9',  // light blue
  '#ffbf79',  // light orange
  '#ff9d98',  // light red
  '#a5cfcb',  // light teal
  '#88d27a',  // light green
  '#f7e1a8',  // light yellow
  '#d6a5c9',  // light purple
  '#fcbfd2',  // light pink
  '#d8b5a5',  // light brown
  '#d3d3d3',  // light gray
];

/**
 * Neutral gray for "Misc" / "Other" / "Uncategorized" wedges that
 * should visually recede rather than compete with categorized slices.
 * Same value as before — slate-400.
 */
export const CHART_NEUTRAL = '#94a3b8';

/**
 * The 10 legacy Tailwind-600 hexes — the chart palette used before the
 * Vega switch. Kept as the secondary half of the color picker's swatch
 * set so users can still pick the older colors.
 */
export const LEGACY_TAILWIND_PALETTE = [
  '#2563eb', '#ea580c', '#16a34a', '#dc2626', '#9333ea',
  '#0891b2', '#db2777', '#ca8a04', '#0d9488', '#7c3aed',
];

/**
 * The full 30-swatch set the ColorSwatchPicker offers: the 20 Vega
 * CHART_PALETTE colors first, then the 10 legacy Tailwind-600 hexes.
 */
export const SWATCH_OPTIONS = [...CHART_PALETTE, ...LEGACY_TAILWIND_PALETTE];

/**
 * Sector → base color map for the SectorDonut.
 *
 * Covers the 11 sectors Yahoo's assetProfile and topHoldings.sectorWeightings
 * endpoints return plus the pseudo-sectors that sector-classification.ts
 * derives from asset class (Fixed Income, Commodities, Crypto, Unclassified,
 * Misc). Yahoo uses Morningstar-style labels ("Financial Services",
 * "Healthcare", "Consumer Cyclical") rather than the older GICS-style names
 * ("Financials", "Health Care", "Consumer Discretionary"), so the keys here
 * mirror Yahoo's exact output — otherwise wedges fall through to the
 * neutral fallback and the donut looks like a grey blob.
 *
 * Hues are spaced around the color wheel so adjacent wedges in a typical
 * portfolio (tech-heavy + finance-heavy) read as distinct sectors at a
 * glance. Unclassified and Misc deliberately use neutral gray so they
 * visually recede the same way the per-ticker donut's "Misc" wedge does.
 */
export const SECTOR_COLORS: Record<string, string> = {
  // 11 Morningstar/Yahoo sector labels — what the live API returns.
  'Technology':              '#3b82f6',
  'Financial Services':      '#10b981',
  'Healthcare':              '#f59e0b',
  'Consumer Cyclical':       '#ef4444',
  'Communication Services':  '#8b5cf6',
  'Industrials':             '#ec4899',
  'Consumer Defensive':      '#14b8a6',
  'Energy':                  '#f97316',
  'Utilities':               '#6366f1',
  'Basic Materials':         '#84cc16',
  'Real Estate':             '#a855f7',
  // Pseudo-sectors derived from asset class in sector-classification.ts.
  'Fixed Income':            '#0ea5e9',
  'Commodities':             '#facc15',
  'Crypto':                  '#f43f5e',
  // Catch-all wedges should visually recede rather than compete with named
  // sectors. Both 'Unclassified' (the pseudo-sector fallback) and 'Misc'
  // (concentration's untracked-fund-tail bucket) use the same neutral.
  'Unclassified':            CHART_NEUTRAL,
  'Misc':                    CHART_NEUTRAL,
};

export function colorForSector(sector: string): string {
  return SECTOR_COLORS[sector] ?? CHART_NEUTRAL;
}

/**
 * Shaded color for the i-th industry wedge inside a drilled-in sector
 * view. Industry order is whatever the caller passes in (typically
 * insertion order from aggregateByIndustry), so the shading is stable
 * across renders as long as the same input order is preserved.
 */
export function shadedColorForIndustry(parentSector: string, index: number): string {
  return shadeHexColor(colorForSector(parentSector), index);
}
