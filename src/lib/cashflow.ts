import type { Transaction, Category } from '@/types/schema';
import { isRealSpending, effectiveSpendingAmount } from '@/lib/spending-analysis';

export interface CashflowWindow {
  inflow: number;
  outflow: number;
  net: number;
  outflowByCategory: Array<{ categoryId: number | null; total: number }>;
}

/**
 * Rolling-window money in vs out. `inflow` is supplied by the caller
 * (paycheck-derived — the Spending page computes it from `persons` salary
 * via `paycheck-periods.ts`). `outflow` is the real-spending total for
 * transactions whose date falls within the trailing `windowDays`. Uses
 * `isRealSpending` (excludes pending reimbursables and INCOME/TRANSFER-
 * category rows) and `effectiveSpendingAmount` (nets out reimbursements) to
 * stay consistent with the Dashboard's "Spending vs Budget" card.
 */
export function cashflowWindow(
  transactions: Transaction[],
  inflow: number,
  windowDays: number,
  categories: Category[],
  asOf: Date = new Date(),
): CashflowWindow {
  const categoriesById = new Map<number, Category>();
  for (const c of categories) if (c.id != null) categoriesById.set(c.id, c);

  const cutoff = new Date(asOf.getTime() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const inWindow = transactions.filter(
    (t) => t.date >= cutoff && isRealSpending(t, categoriesById),
  );
  const outflow = inWindow.reduce((s, t) => s + effectiveSpendingAmount(t), 0);

  const byCat = new Map<number | null, number>();
  for (const t of inWindow) {
    byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + effectiveSpendingAmount(t));
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
