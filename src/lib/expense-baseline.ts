import type { Transaction } from '@/types/schema';

/**
 * Computes a monthly expense baseline from a 12-month rolling window of
 * transactions, anchored at `asOfISO`. The divisor is the number of
 * distinct YYYY-MM months observed in the window (capped at 12 by the
 * window itself). A user with 4 months of data gets `totalOutflow / 4`,
 * not `totalOutflow / 12` — so the baseline reflects their actual
 * average rather than being diluted by months with no records.
 *
 * Returns 0 when no qualifying transactions exist in the window.
 *
 * Outflow-detection note: this preserves the existing convention used by
 * `state-snapshot.ts` (filters `amount < 0` and sums absolute values).
 * The Transaction schema actually documents `positive = purchase,
 * negative = payment/credit`, so this is inverted relative to the rest
 * of the codebase. Kept as-is here to keep this commit a pure
 * extraction; sign correction is tracked separately.
 */
export function computeBaselineExpenses(
  transactions: Transaction[],
  asOfISO: string,
): number {
  const startMs = Date.parse(asOfISO);
  const horizonMs = 12 * 30 * 86_400_000;
  const recent = transactions.filter(
    (t) =>
      t.amount < 0 &&
      Date.parse(t.date) >= startMs - horizonMs &&
      Date.parse(t.date) <= startMs,
  );
  if (recent.length === 0) return 0;
  const totalOutflow = recent.reduce((acc, t) => acc + Math.abs(t.amount), 0);
  const monthsObserved = new Set(recent.map((t) => t.date.slice(0, 7))).size;
  return totalOutflow / Math.max(monthsObserved, 1);
}
