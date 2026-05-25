import type { Transaction, Category } from '@/types/schema';
import { isRealSpending, effectiveSpendingAmount } from './spending-analysis';

export type SpendingRange =
  | 'this-month'
  | 'last-month'
  | 'last-30'
  | 'last-90'
  | 'ytd'
  | 'last-12';

export interface SpendingRangeBounds {
  startInclusive: string; // YYYY-MM-DD
  endInclusive: string;   // YYYY-MM-DD
}

/**
 * Resolve a SpendingRange to inclusive ISO date bounds, anchored at `asOf`.
 * The dashboard's spending widget feeds these bounds into filterByRange so
 * the donut, bar chart, and "Your Spending" list all agree on the window.
 */
export function rangeBounds(range: SpendingRange, asOf: Date): SpendingRangeBounds {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  const d = asOf.getUTCDate();
  const toIso = (date: Date) => date.toISOString().slice(0, 10);

  switch (range) {
    case 'this-month': {
      const start = new Date(Date.UTC(y, m, 1));
      const end = new Date(Date.UTC(y, m + 1, 0)); // last day of current month
      return { startInclusive: toIso(start), endInclusive: toIso(end) };
    }
    case 'last-month': {
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 0)); // last day of prior month
      return { startInclusive: toIso(start), endInclusive: toIso(end) };
    }
    case 'last-30': {
      const start = new Date(Date.UTC(y, m, d - 29));
      const end = new Date(Date.UTC(y, m, d));
      return { startInclusive: toIso(start), endInclusive: toIso(end) };
    }
    case 'last-90': {
      const start = new Date(Date.UTC(y, m, d - 89));
      const end = new Date(Date.UTC(y, m, d));
      return { startInclusive: toIso(start), endInclusive: toIso(end) };
    }
    case 'ytd': {
      const start = new Date(Date.UTC(y, 0, 1));
      const end = new Date(Date.UTC(y, m, d));
      return { startInclusive: toIso(start), endInclusive: toIso(end) };
    }
    case 'last-12': {
      const start = new Date(Date.UTC(y - 1, m, d + 1));
      const end = new Date(Date.UTC(y, m, d));
      return { startInclusive: toIso(start), endInclusive: toIso(end) };
    }
  }
}

export interface SpendingByCategory {
  categoryId: number | null;
  name: string;
  color: string | null;
  total: number;
  count: number;
}

export interface SpendingWidgetSummary {
  total: number;
  totalCount: number;
  byCategory: SpendingByCategory[];
  /** Category with the most transactions in the range. */
  topByCount: { name: string; count: number } | null;
}

const UNCATEGORIZED_NAME = 'Uncategorized';

/**
 * Aggregate spending transactions for the dashboard widget. Wraps
 * `isRealSpending` + `effectiveSpendingAmount` so only purchases count
 * (income/transfer categories are excluded automatically). Misc/Other
 * categories are *included* — this widget surfaces full category coverage;
 * the concentration-style Misc filter only applies to investments.
 *
 * Inputs:
 *   - `transactions`: the source list (caller scopes it by view filter).
 *   - `categories`: lookup for resolving categoryId → name + color.
 *   - `range`: inclusive ISO date bounds; transactions outside are dropped.
 *   - `accountId`: optional source-account filter; null/undefined = all.
 *   - `merchantQuery`: optional case-insensitive substring match on merchant
 *     name; an empty string disables the filter.
 *
 * Output rows are sorted by `total` descending, then by `count` descending
 * as a stable tiebreaker.
 */
export function summarizeSpendingForRange(
  transactions: Transaction[],
  categories: Category[],
  range: SpendingRangeBounds,
  options: { accountId?: number | null; merchantQuery?: string } = {},
): SpendingWidgetSummary {
  const byId = new Map<number, Category>();
  for (const c of categories) if (c.id != null) byId.set(c.id, c);

  const merchantNeedle = options.merchantQuery?.trim().toUpperCase() ?? '';
  const accountFilter = options.accountId ?? null;

  const inRange = transactions.filter((t) => {
    if (t.date < range.startInclusive) return false;
    if (t.date > range.endInclusive) return false;
    if (!isRealSpending(t, byId)) return false;
    if (accountFilter != null && t.sourceAccountId !== accountFilter) return false;
    if (merchantNeedle && !t.merchant.toUpperCase().includes(merchantNeedle)) return false;
    return true;
  });

  // Aggregate by category. Null categoryId rolls up to "Uncategorized" with
  // a neutral color so the donut still shows a wedge for it.
  const buckets = new Map<number | 'NONE', { total: number; count: number }>();
  for (const t of inRange) {
    const key: number | 'NONE' = t.categoryId ?? 'NONE';
    const cur = buckets.get(key) ?? { total: 0, count: 0 };
    cur.total += effectiveSpendingAmount(t);
    cur.count += 1;
    buckets.set(key, cur);
  }

  const byCategory: SpendingByCategory[] = [];
  for (const [key, agg] of buckets) {
    if (key === 'NONE') {
      byCategory.push({
        categoryId: null,
        name: UNCATEGORIZED_NAME,
        color: null,
        total: agg.total,
        count: agg.count,
      });
      continue;
    }
    const cat = byId.get(key);
    byCategory.push({
      categoryId: key,
      name: cat?.name ?? `Category ${key}`,
      color: cat?.color ?? null,
      total: agg.total,
      count: agg.count,
    });
  }

  byCategory.sort((a, b) => b.total - a.total || b.count - a.count);

  const total = byCategory.reduce((sum, c) => sum + c.total, 0);
  const totalCount = byCategory.reduce((sum, c) => sum + c.count, 0);

  // "Most purchases" callout: category with the highest count.
  const topByCount = [...byCategory]
    .sort((a, b) => b.count - a.count || b.total - a.total)[0] ?? null;

  return {
    total,
    totalCount,
    byCategory,
    topByCount: topByCount ? { name: topByCount.name, count: topByCount.count } : null,
  };
}
