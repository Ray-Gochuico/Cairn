/**
 * Default chart palette. Tailwind 600-weight hues picked for high
 * distinguishability and colorblind-friendly contrast. Order chosen so
 * that 2-series charts get the most-distinct pair (blue + orange) and
 * 3-series get red/blue/green (matching the compound-interest variance
 * pattern).
 *
 * Consumers that want explicit per-slice or per-series colors should
 * pass them via the slice/series `color` field; this palette is only
 * used as a default when no explicit color is supplied.
 */
export const CHART_PALETTE = [
  '#2563eb',  // blue-600
  '#ea580c',  // orange-600
  '#16a34a',  // green-600
  '#dc2626',  // red-600
  '#9333ea',  // purple-600
  '#0891b2',  // cyan-600
  '#db2777',  // pink-600
  '#ca8a04',  // yellow-600
  '#0d9488',  // teal-600
  '#7c3aed',  // violet-600
];

/**
 * Neutral gray for "Misc" / "Other" / "Uncategorized" wedges that
 * should visually recede rather than compete with categorized slices.
 */
export const CHART_NEUTRAL = '#94a3b8';  // slate-400
