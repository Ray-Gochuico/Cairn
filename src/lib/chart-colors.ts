import { CHART_PALETTE } from '@/components/charts/palette';

/**
 * Resolved chart color for an account. If a non-empty hex override is
 * supplied (the user's pick, stored on accounts.accent_color), it wins.
 * Otherwise the deterministic default: accountId modulo the palette
 * length — two accounts with neighboring ids get adjacent palette
 * colors, and the result is stable across re-renders.
 *
 * Default collisions happen after CHART_PALETTE.length accounts;
 * acceptable for a household app, and exactly what the picker lets the
 * user fix.
 */
export function colorForAccount(accountId: number, override?: string | null): string {
  if (override) return override;
  return CHART_PALETTE[Math.abs(accountId) % CHART_PALETTE.length];
}

/**
 * Resolved chart color for a ticker. If a non-empty hex override is
 * supplied (the user's pick, stored on tickers.accent_color), it wins.
 * Otherwise a deterministic string-hash of the ticker symbol mapped to
 * a palette index — stable per ticker and position-independent. Two
 * symbols can hash to the same palette index; the picker lets the user
 * fix that.
 */
export function colorForTicker(ticker: string, override?: string | null): string {
  if (override) return override;
  return CHART_PALETTE[hashTicker(ticker) % CHART_PALETTE.length];
}

function hashTicker(ticker: string): number {
  let h = 0;
  for (let i = 0; i < ticker.length; i++) {
    h = (Math.imul(h, 31) + ticker.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
