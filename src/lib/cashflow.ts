import type { Transaction } from '@/types/schema';

export interface CashflowWindow {
  inflow: number;
  outflow: number;
  net: number;
  outflowByCategory: Array<{ categoryId: number | null; total: number }>;
}

/**
 * Rolling-window money in vs out. `inflow` is supplied by the caller
 * (paycheck-derived — the Spending page computes it from `persons` salary
 * via `paycheck-periods.ts`). `outflow` is the sum of positive-amount
 * transactions whose date falls within the trailing `windowDays`.
 */
export function cashflowWindow(
  transactions: Transaction[],
  inflow: number,
  windowDays: number,
  asOf: Date = new Date(),
): CashflowWindow {
  const cutoff = new Date(asOf.getTime() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const inWindow = transactions.filter((t) => t.date >= cutoff && t.amount > 0);
  const outflow = inWindow.reduce((s, t) => s + t.amount, 0);

  const byCat = new Map<number | null, number>();
  for (const t of inWindow) {
    byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amount);
  }

  return {
    inflow,
    outflow,
    net: inflow - outflow,
    outflowByCategory: [...byCat.entries()].map(([categoryId, total]) => ({
      categoryId,
      total,
    })),
  };
}
