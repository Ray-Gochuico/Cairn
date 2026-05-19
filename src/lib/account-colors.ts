import { CHART_PALETTE } from '@/components/charts/palette';

/**
 * Stable color for an account, via accountId modulo the palette length.
 * Two accounts with neighboring ids get adjacent palette colors, which
 * matches the human intuition of "account 1 = first color, account 2 =
 * second color" — but accounts are stable across re-renders because the
 * function is pure of the id alone.
 *
 * Collisions happen after CHART_PALETTE.length accounts (currently 10).
 * Acceptable for a household app with rarely more than ~10 accounts.
 */
export function colorForAccount(accountId: number): string {
  const idx = Math.abs(accountId) % CHART_PALETTE.length;
  return CHART_PALETTE[idx];
}
