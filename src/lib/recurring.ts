import type { Transaction, Category } from '@/types/schema';

export interface RecurringGroup {
  merchant: string;
  transactionIds: number[];
  averageAmount: number;
  occurrences: number;
  /** Wave-9 M20: median charge cadence in whole months (1–3). */
  cadenceMonths: number;
  /** averageAmount normalized to a per-month figure (÷ cadenceMonths). */
  monthlyAmount: number;
}

const DAY = 86_400_000;
const AMOUNT_SPREAD_MAX = 0.25; // (max-min)/mean
const MONTH_DAYS = 30.44;
const GAP_TOLERANCE_DAYS = 8;
const MAX_MONTH_MULTIPLE = 3; // tolerate up to ~2 skipped months between charges

/**
 * True when `gapDays` is within tolerance of a whole number of months (1–3),
 * so an occasional skipped or refunded month does not disqualify an otherwise
 * monthly series.
 */
function isMonthlyGap(gapDays: number): boolean {
  const k = Math.round(gapDays / MONTH_DAYS);
  return k >= 1 && k <= MAX_MONTH_MULTIPLE && Math.abs(gapDays - k * MONTH_DAYS) <= GAP_TOLERANCE_DAYS;
}

/**
 * Detect recurring (subscription-like) transactions: the same merchant,
 * similar amount, at a roughly monthly cadence over >=2 occurrences.
 *
 * Skips credits (amount <= 0) and any transaction whose category resolves to
 * an INCOME- or TRANSFER-typed category — debt payments and transfers are not
 * subscriptions. Uncategorized transactions (categoryId null) remain eligible.
 */
export function detectRecurring(transactions: Transaction[], categories: Category[]): RecurringGroup[] {
  const catById = new Map<number, Category>(
    categories.flatMap((c) => (c.id != null ? [[c.id, c]] : [])),
  );
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount <= 0) continue; // subscriptions are charges, not credits
    if (t.categoryId != null) {
      const cat = catById.get(t.categoryId);
      if (cat?.type === 'INCOME' || cat?.type === 'TRANSFER') continue;
    }
    const key = t.merchant.toUpperCase();
    const list = byMerchant.get(key) ?? [];
    list.push(t);
    byMerchant.set(key, list);
  }

  const groups: RecurringGroup[] = [];
  for (const [merchant, list] of byMerchant) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));

    const amounts = sorted.map((t) => t.amount);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (mean === 0) continue;
    if ((Math.max(...amounts) - Math.min(...amounts)) / mean > AMOUNT_SPREAD_MAX) continue;

    let monthly = true;
    const gapMonths: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = (Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date)) / DAY;
      if (!isMonthlyGap(gap)) {
        monthly = false;
        break;
      }
      gapMonths.push(Math.max(1, Math.round(gap / MONTH_DAYS)));
    }
    if (!monthly) continue;
    // Wave-9 M20: the gap check tolerates 1–3-month cadences, but the raw
    // per-charge mean was rendered as "$X/mo" — a quarterly biller read 3×
    // its true monthly cost. Median rounded gap = the group's cadence.
    const sortedGaps = [...gapMonths].sort((a, b) => a - b);
    const cadenceMonths = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 1;

    groups.push({
      merchant,
      transactionIds: sorted.map((t) => t.id).filter((id): id is number => id != null),
      averageAmount: mean,
      occurrences: sorted.length,
      cadenceMonths,
      monthlyAmount: mean / cadenceMonths,
    });
  }
  return groups;
}
