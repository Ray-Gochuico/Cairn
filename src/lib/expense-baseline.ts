import type { Transaction } from '@/types/schema';

/**
 * Sum of |outflows| over the 12 months leading up to startISO, divided by the
 * number of distinct months actually observed. This is the same rolling-average
 * baseline used by the What-If engine and the ExpensesPopover quick-select.
 */
export function computeBaselineExpenses(transactions: Transaction[], startISO: string): number {
  const startMs = Date.parse(startISO);
  const horizonMs = 12 * 30 * 86_400_000;
  const recent = transactions.filter(
    (t) => t.amount < 0 && Date.parse(t.date) >= startMs - horizonMs && Date.parse(t.date) <= startMs,
  );
  if (recent.length === 0) return 0;
  const totalOutflow = recent.reduce((acc, t) => acc + Math.abs(t.amount), 0);
  const monthsObserved = new Set(recent.map((t) => t.date.slice(0, 7))).size;
  return totalOutflow / Math.max(monthsObserved, 1);
}

export interface MonthlyExpenseTotal {
  monthISO: string;       // 'YYYY-MM'
  total: number;          // sum of |outflows| in that month
}

/** Returns the top N most-recent month totals (descending by monthISO). */
export function recentMonthlyExpenseTotals(
  transactions: Transaction[],
  startISO: string,
  count: number,
): MonthlyExpenseTotal[] {
  const startMs = Date.parse(startISO);
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount >= 0) continue;
    const tMs = Date.parse(t.date);
    if (tMs > startMs) continue;
    const month = t.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + Math.abs(t.amount));
  }
  const sorted = Array.from(byMonth.entries())
    .map(([monthISO, total]) => ({ monthISO, total }))
    .sort((a, b) => (a.monthISO < b.monthISO ? 1 : -1));
  return sorted.slice(0, count);
}
