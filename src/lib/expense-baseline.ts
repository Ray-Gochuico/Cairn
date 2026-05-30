import type { Transaction, Category } from '@/types/schema';
import { isRealSpending, effectiveSpendingAmount } from '@/lib/spending-analysis';

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

/**
 * Feature B mode resolver — trailing-12-month average monthly REAL spending,
 * anchored at `asOfISO`. The window is a CALENDAR-MONTH bound — the 12 most
 * recent months up to and including asOf's month (`lowerMonth <= m <= asOfMonth`,
 * via YYYY-MM string compare) — NOT a 360-day (12*30d) day-window. The day-window
 * dropped boundary months non-deterministically by day-of-month and diverged from
 * latestCompleteMonthBaseline's month-string compare; the calendar bound coheres
 * with it (same `slice(0,7)` granularity). Divisor = distinct YYYY-MM months
 * observed (so 4 months of data → /4, not /12), matching computeBaselineExpenses'
 * shape. Unlike that helper this routes through isRealSpending/effectiveSpendingAmount
 * so the figure matches the Spending page (excludes TRANSFER/INCOME, nets
 * reimbursements). Returns 0 when no real spending exists in the window.
 *
 * Note (intentional, coheres with latestMonth): rolling12m INCLUDES asOf's
 * in-progress month (it averages every observed month `<= asOfMonth`); latestMonth
 * EXCLUDES it (`< asOfMonth`). They share the month-string convention but differ in
 * inclusivity by design — an average is robust to a partial month, a single-month
 * pick is not.
 */
export function rolling12mBaseline(
  transactions: Transaction[],
  categories: Category[],
  asOfISO: string,
): number {
  const byId = new Map<number, Category>();
  for (const c of categories) if (c.id != null) byId.set(c.id, c);
  const asOfMonth = asOfISO.slice(0, 7); // 'YYYY-MM'
  // Calendar lower bound: 11 whole months before asOf's month (inclusive of asOf's
  // month → a 12-month span). Pure year/month arithmetic on the 'YYYY-MM' prefix,
  // so it is day-of-month invariant and uses the same string compare as latestMonth.
  const y = Number(asOfMonth.slice(0, 4));
  const m = Number(asOfMonth.slice(5, 7)); // 1..12
  const lowerIdx = y * 12 + (m - 1) - 11; // monthsSinceEpoch index of the lower bound
  const lowerMonth = `${String(Math.floor(lowerIdx / 12)).padStart(4, '0')}-${String((lowerIdx % 12) + 1).padStart(2, '0')}`;
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!isRealSpending(t, byId)) continue;
    const month = t.date.slice(0, 7);
    if (month < lowerMonth || month > asOfMonth) continue; // calendar-month window
    byMonth.set(month, (byMonth.get(month) ?? 0) + effectiveSpendingAmount(t));
  }
  if (byMonth.size === 0) return 0;
  let total = 0;
  for (const v of byMonth.values()) total += v;
  return total / byMonth.size;
}

/**
 * Feature B mode resolver — total REAL spending in the latest COMPLETE month,
 * i.e. the most recent YYYY-MM strictly before asOf's month. Excludes the
 * in-progress month (a naive "most recent month" would understate the base on
 * any day but the last of the month). Returns 0 when no complete month has real
 * spending. Real-spending-filtered (Spending-page parity).
 */
export function latestCompleteMonthBaseline(
  transactions: Transaction[],
  categories: Category[],
  asOfISO: string,
): number {
  const byId = new Map<number, Category>();
  for (const c of categories) if (c.id != null) byId.set(c.id, c);
  const asOfMonth = asOfISO.slice(0, 7);
  const byMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!isRealSpending(t, byId)) continue;
    const month = t.date.slice(0, 7);
    if (month >= asOfMonth) continue; // exclude in-progress + future months
    byMonth.set(month, (byMonth.get(month) ?? 0) + effectiveSpendingAmount(t));
  }
  if (byMonth.size === 0) return 0;
  let latest = '';
  for (const k of byMonth.keys()) if (k > latest) latest = k;
  return byMonth.get(latest) ?? 0;
}
