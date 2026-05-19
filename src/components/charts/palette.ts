/**
 * Default chart palette. Vega category10 (Tableau-derived) — picked for
 * chart-specific aesthetic and distinguishability across many wedges /
 * series. Used by all chart primitives (DonutChartCard, LineChartCard,
 * BarChartCard) and the InvestmentTimeSeriesChart per-account stack.
 *
 * Consumers that want explicit per-slice or per-series colors should
 * pass them via the slice/series `color` field; this palette is only
 * used as a default when no explicit color is supplied.
 */
export const CHART_PALETTE = [
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
];

/**
 * Neutral gray for "Misc" / "Other" / "Uncategorized" wedges that
 * should visually recede rather than compete with categorized slices.
 * Same value as before — slate-400.
 */
export const CHART_NEUTRAL = '#94a3b8';
