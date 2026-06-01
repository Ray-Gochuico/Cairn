export const formatCurrency = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export const formatPercent = (n: number): string =>
  new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(n);

/**
 * Adaptive dollar formatter for chart axes. Scales suffix by magnitude:
 *   |v| < $1,000        -> "$500"
 *   $1k ≤ |v| < $1M     -> "$80k" / "$1.5k" (1 decimal only if non-whole)
 *   |v| >= $1M          -> "$1.2M" / "$5M"  (1 decimal only if non-whole)
 *
 * For tooltip and detail-row dollar values prefer `formatCurrency` from
 * the same module, which renders the full "$80,000" form (no cents).
 */
export function formatCompactCurrency(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const m = v / 1_000_000;
    return '$' + (Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)) + 'M';
  }
  if (abs >= 1_000) {
    const k = v / 1_000;
    return '$' + (Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)) + 'k';
  }
  return '$' + v.toFixed(0);
}
