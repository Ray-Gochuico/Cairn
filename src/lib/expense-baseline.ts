import type { Transaction, Category } from '@/types/schema';
import { isRealSpending, effectiveSpendingAmount } from '@/lib/spending-analysis';
import { MONTHLY_INPUT_GRACE_DAY } from '@/lib/input-pending';

// NOTE (Wave 2 §8): the legacy raw `amount > 0` baseline helper — which
// counted credit-card-payment transfers and pending reimbursables as spending
// — was DELETED from this module. Its only consumer (the Roadmap
// emergency-fund rules) now uses `rolling12mBaseline` below, the same
// real-spending pipeline as the Spending page and the What-If expense basis.

export interface MonthlyExpenseTotal {
  monthISO: string;       // 'YYYY-MM'
  total: number;          // sum of expense outflows in that month
}

/**
 * Returns the top N most-recent month totals (descending by monthISO),
 * using the raw amount-sign convention (`amount > 0` = expense outflow).
 * Future months (relative to `asOfISO`) are excluded.
 * (Pre-existing orphan — no src callers; deliberately untouched in Wave 2.)
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

/** 'YYYY-MM' for a months-since-epoch index (`y * 12 + (m - 1)`). Pure
 *  integer/string arithmetic — never a Date, so no zone can shift a window. */
function monthFromIndex(idx: number): string {
  return `${String(Math.floor(idx / 12)).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export interface RollingBaselineDetail {
  /** Average real spending per observed complete month; 0 when monthsObserved === 0. */
  average: number;
  /** Distinct complete months in the window with ≥ 1 real-spending row, after the
   *  first-month guard. 0..12 — the COUNT every consumer states. */
  monthsObserved: number;
  /** Inclusive 'YYYY-MM' bounds: the 12 complete months before asOf's month. */
  window: { fromMonth: string; toMonth: string };
  /** R1-F6: the history's first month, dropped because its first real-spending
   *  row is dated after MONTHLY_INPUT_GRACE_DAY; null when the guard did not fire. */
  droppedFirstMonth: string | null;
}

/**
 * Roadmap / What-If spending baseline (v1.7.0 R1): average monthly REAL
 * spending over the 12 most recent COMPLETE calendar months before `asOfISO`'s
 * month — window `[asOfMonth − 12, asOfMonth − 1]` on the 'YYYY-MM' prefix
 * (day-of-month invariant; accepts 'YYYY-MM-DD' or the What-If capture's
 * 'YYYY-MM'). The in-progress month never counts: a partial month at full
 * weight understated the figure by up to 1/(n+1) of a month and moved it on
 * every posting; this figure is flat within a month and moves once, on the 1st,
 * for a fixed transaction set. Both selectors in this module now exclude the
 * as-of month (latestCompleteMonthBaseline always did).
 *
 * Divisor = distinct observed months (a 3-month history averages over 3, not
 * 12) — `monthsObserved` is returned so every consumer can state it. Routes
 * through isRealSpending/effectiveSpendingAmount (Spending-page parity:
 * TRANSFER/INCOME out, pending reimbursables out, reimbursed rows at net).
 *
 * First-month guard (⚑ R1-F6 ON): a history that BEGINS mid-month yields a
 * half-observed "complete" first month. If the earliest real-spending row of
 * the entire set falls in an observed month and is dated after the grace day
 * (MONTHLY_INPUT_GRACE_DAY, shared with the monthly-input prompt), that month
 * leaves numerator and divisor. A history older than the window makes the
 * guard inert — the window's first month is a full month of an established
 * history. Only the first month is inspected; never recursive.
 */
export function rolling12mBaselineDetail(
  transactions: Transaction[],
  categories: Category[],
  asOfISO: string,
): RollingBaselineDetail {
  const byId = new Map<number, Category>();
  for (const c of categories) if (c.id != null) byId.set(c.id, c);
  const asOfMonth = asOfISO.slice(0, 7); // 'YYYY-MM'
  const asOfIdx = Number(asOfMonth.slice(0, 4)) * 12 + (Number(asOfMonth.slice(5, 7)) - 1);
  const window = { fromMonth: monthFromIndex(asOfIdx - 12), toMonth: monthFromIndex(asOfIdx - 1) };
  const byMonth = new Map<string, number>();
  let earliestRealDate: string | null = null; // across the ENTIRE set — the guard asks where the history begins
  for (const t of transactions) {
    if (!isRealSpending(t, byId)) continue;
    if (earliestRealDate === null || t.date < earliestRealDate) earliestRealDate = t.date;
    const month = t.date.slice(0, 7);
    if (month < window.fromMonth || month > window.toMonth) continue; // complete-month window
    byMonth.set(month, (byMonth.get(month) ?? 0) + effectiveSpendingAmount(t));
  }
  let droppedFirstMonth: string | null = null;
  if (earliestRealDate !== null) {
    const firstMonth = earliestRealDate.slice(0, 7);
    if (byMonth.has(firstMonth) && Number(earliestRealDate.slice(8, 10)) > MONTHLY_INPUT_GRACE_DAY) {
      byMonth.delete(firstMonth);
      droppedFirstMonth = firstMonth;
    }
  }
  if (byMonth.size === 0) return { average: 0, monthsObserved: 0, window, droppedFirstMonth };
  let total = 0;
  for (const v of byMonth.values()) total += v;
  return { average: total / byMonth.size, monthsObserved: byMonth.size, window, droppedFirstMonth };
}

/** The scalar form every existing call site uses — `rolling12mBaselineDetail(...).average`. */
export function rolling12mBaseline(
  transactions: Transaction[],
  categories: Category[],
  asOfISO: string,
): number {
  return rolling12mBaselineDetail(transactions, categories, asOfISO).average;
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
