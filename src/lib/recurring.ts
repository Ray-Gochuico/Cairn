import type { Transaction } from '@/types/schema';

export interface RecurringGroup {
  merchant: string;
  transactionIds: number[];
  averageAmount: number;
  occurrences: number;
}

const DAY = 86_400_000;
const AMOUNT_SPREAD_MAX = 0.25; // (max-min)/mean
const GAP_MIN_DAYS = 20;
const GAP_MAX_DAYS = 45;

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
      if (gap < GAP_MIN_DAYS || gap > GAP_MAX_DAYS) {
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
