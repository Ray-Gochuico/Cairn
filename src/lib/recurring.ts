import type { Transaction } from '@/types/schema';

export interface RecurringGroup {
  merchant: string;
  transactionIds: number[];
  averageAmount: number;
  occurrences: number;
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
 */
export function detectRecurring(transactions: Transaction[]): RecurringGroup[] {
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount <= 0) continue; // subscriptions are charges, not credits
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
    for (let i = 1; i < sorted.length; i++) {
      const gap = (Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date)) / DAY;
      if (!isMonthlyGap(gap)) {
        monthly = false;
        break;
      }
    }
    if (!monthly) continue;

    groups.push({
      merchant,
      transactionIds: sorted.map((t) => t.id).filter((id): id is number => id != null),
      averageAmount: mean,
      occurrences: sorted.length,
    });
  }
  return groups;
}
