import type { Transaction, Category } from '@/types/schema';

export interface MonthlyCategoryTotal {
  month: string; // YYYY-MM
  categoryId: number | null;
  total: number;
}
export interface MerchantTotal {
  merchant: string;
  total: number;
  count: number;
}
export interface SpendingSummary {
  monthlyByCategory: MonthlyCategoryTotal[];
  monthlyTotals: Array<{ month: string; total: number }>;
  topMerchants: MerchantTotal[];
  currentMonth: string;
  currentMonthTotal: number;
  previousMonthTotal: number;
}

const NON_SPENDING_TYPES = new Set<Category['type']>(['INCOME', 'TRANSFER']);

/**
 * "Real spending" — a positive-amount charge that is not a pending
 * reimbursable and not in an Income/Transfer category. Uncategorized
 * (categoryId null) positive charges count.
 */
export function isRealSpending(
  txn: Transaction,
  categoriesById: Map<number, Category>,
): boolean {
  if (txn.amount <= 0) return false;
  if (txn.reimbursable && txn.reimbursedAt == null) return false;
  if (txn.categoryId != null) {
    const cat = categoriesById.get(txn.categoryId);
    if (cat && NON_SPENDING_TYPES.has(cat.type)) return false;
  }
  return true;
}

/** Aggregate transactions into the Spending-page summary. */
export function summarizeSpending(
  transactions: Transaction[],
  categories: Category[],
  asOf: Date = new Date(),
): SpendingSummary {
  const byId = new Map<number, Category>();
  for (const c of categories) if (c.id != null) byId.set(c.id, c);
  const spend = transactions.filter((t) => isRealSpending(t, byId));

  const monthCat = new Map<string, number>(); // "YYYY-MM|catId" -> total
  const monthTot = new Map<string, number>();
  const merchant = new Map<string, { total: number; count: number }>();

  for (const t of spend) {
    const m = t.date.slice(0, 7);
    const ck = `${m}|${t.categoryId ?? 0}`;
    monthCat.set(ck, (monthCat.get(ck) ?? 0) + t.amount);
    monthTot.set(m, (monthTot.get(m) ?? 0) + t.amount);
    const mk = t.merchant.toUpperCase();
    const cur = merchant.get(mk) ?? { total: 0, count: 0 };
    merchant.set(mk, { total: cur.total + t.amount, count: cur.count + 1 });
  }

  const monthlyByCategory: MonthlyCategoryTotal[] = [...monthCat.entries()].map(
    ([k, total]) => {
      const [month, cid] = k.split('|');
      return { month, categoryId: cid === '0' ? null : Number(cid), total };
    },
  );
  const monthlyTotals = [...monthTot.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const topMerchants = [...merchant.entries()]
    .map(([m, v]) => ({ merchant: m, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const currentMonth = asOf.toISOString().slice(0, 7);
  const prevMonth = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1),
  )
    .toISOString()
    .slice(0, 7);

  return {
    monthlyByCategory,
    monthlyTotals,
    topMerchants,
    currentMonth,
    currentMonthTotal: monthTot.get(currentMonth) ?? 0,
    previousMonthTotal: monthTot.get(prevMonth) ?? 0,
  };
}
