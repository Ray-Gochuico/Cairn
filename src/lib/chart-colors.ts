import { paletteColorAt } from '@/components/charts/palette';

/**
 * Resolved chart color for an account. If a non-empty hex override is
 * supplied (the user's pick, stored on accounts.accent_color), it wins.
 * Otherwise the deterministic default: accountId modulo the WEDGE_PALETTE
 * length — two accounts with neighboring ids get adjacent palette colors,
 * and the result is stable across re-renders.
 *
 * Default collisions happen after WEDGE_PALETTE.length accounts; acceptable
 * for a household app, and exactly what the picker lets the user fix.
 * Assigning over WEDGE_PALETTE (not the legacy CHART_PALETTE) guarantees the
 * default is never a near-white wedge (the I9 fix).
 */
export function colorForAccount(accountId: number, override?: string | null): string {
  if (override) return override;
  return paletteColorAt(Math.abs(accountId));
}

/**
 * Resolved chart color for a ticker. If a non-empty hex override is
 * supplied (the user's pick, stored on tickers.accent_color), it wins.
 * Otherwise a deterministic string-hash of the ticker symbol mapped to a
 * WEDGE_PALETTE index — stable per ticker and position-independent (the same
 * symbol reads as the same color across every view, by design). Two symbols
 * can hash to the same palette index; the picker lets the user fix that.
 */
export function colorForTicker(ticker: string, override?: string | null): string {
  if (override) return override;
  return paletteColorAt(hashString(ticker));
}

/**
 * Resolved chart color for a loan. Override wins; otherwise loanId modulo the
 * WEDGE_PALETTE length — stable per loan id, position-independent. The
 * id-keyed default is what the Liabilities donut attaches to each slice so the
 * wedge, legend, and picker swatch stay in lockstep through entity-hide.
 */
export function colorForLoan(loanId: number, override?: string | null): string {
  if (override) return override;
  return paletteColorAt(Math.abs(loanId));
}

/**
 * Resolved chart color for a composite entity key (e.g. `property:1`,
 * `vehicle:1`). Override wins; otherwise a deterministic string-hash of the
 * key mapped to a WEDGE_PALETTE index — so same-id different-kind entities
 * (`property:1` vs `vehicle:1`) don't collide. Used by the Assets donut for
 * properties/vehicles and any other entity that lacks a numeric id key.
 */
export function colorForEntityKey(key: string, override?: string | null): string {
  if (override) return override;
  return paletteColorAt(hashString(key));
}

/** Deterministic non-negative string hash (djb2-ish, 32-bit). */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
