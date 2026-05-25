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
 * Sign convention: per the Transaction schema (`src/types/schema.ts`),
 * `amount > 0` is a purchase (expense) and `amount < 0` is a refund or
 * credit. Other consumers (spending-analysis, recurring) follow the
 * same convention. We filter `amount > 0` here to sum actual outflows.
 */
export function computeBaselineExpenses(
  transactions: Transaction[],
  asOfISO: string,
): number {
  const startMs = Date.parse(asOfISO);
  const horizonMs = 12 * 30 * 86_400_000;
  const recent = transactions.filter(
    (t) =>
      t.amount > 0 &&
      Date.parse(t.date) >= startMs - horizonMs &&
      Date.parse(t.date) <= startMs,
  );
  if (recent.length === 0) return 0;
  const totalOutflow = recent.reduce((acc, t) => acc + t.amount, 0);
  const monthsObserved = new Set(recent.map((t) => t.date.slice(0, 7))).size;
  return totalOutflow / Math.max(monthsObserved, 1);
}

export interface MonthlyExpenseTotal {
  monthISO: string;       // 'YYYY-MM'
  total: number;          // sum of expense outflows in that month
}

/**
 * Returns the top N most-recent month totals (descending by monthISO),
 * using the same sign convention as `computeBaselineExpenses`.
 * Future months (relative to `asOfISO`) are excluded.
 */
export function recentMonthlyExpenseTotals(
  transactions: Transaction[],
  asOfISO: string,
  count: number,
): MonthlyExpenseTotal[] {
  const startMs = Date.parse(asOfISO);
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const tMs = Date.parse(t.date);
    if (tMs > startMs) continue;
    const month = t.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + t.amount);
  }
  const sorted = Array.from(byMonth.entries())
    .map(([monthISO, total]) => ({ monthISO, total }))
    .sort((a, b) => (a.monthISO < b.monthISO ? 1 : -1));
  return sorted.slice(0, count);
}
