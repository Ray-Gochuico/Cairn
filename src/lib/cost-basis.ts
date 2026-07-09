import type { Transaction, Category } from '@/types/schema';
import { isRealSpending, effectiveSpendingAmount } from '@/lib/spending-analysis';

/**
 * Cost basis of a property = purchase price + capital-improvement spend
 * (transactions linked to the property whose category is `is_capital`).
 */
export function propertyCostBasis(
  purchasePrice: number | null,
  propertyId: number,
  transactions: Transaction[],
  categories: Category[],
): number {
  const capitalIds = new Set(
    categories.filter((c) => c.isCapital && c.id != null).map((c) => c.id as number),
  );
  const improvements = transactions
    .filter(
      (t) =>
        t.propertyId === propertyId &&
        t.categoryId != null &&
        capitalIds.has(t.categoryId) &&
        // Wave-9 M13: a pending reimbursable isn't (yet) the owner's money —
        // same contract as every spending surface (isRealSpending).
        !(t.reimbursable && t.reimbursedAt == null),
    )
    // Settled reimbursements net out (effectiveSpendingAmount), matching
    // rollingExpense/allLinkedSpending in this same file.
    .reduce((s, t) => s + effectiveSpendingAmount(t), 0);
  return (purchasePrice ?? 0) + improvements;
}

/**
 * Real-spending transactions linked to a property/vehicle within the trailing
 * `months` window, sorted newest-first. Uses `isRealSpending` (excludes pending
 * reimbursables and INCOME/TRANSFER-category rows). The Property and Vehicles
 * pages render this list directly so users can see which charges contribute to
 * the rolling expense total below each card's "12-mo expense" row.
 */
export function linkedSpendingTransactions(
  transactions: Transaction[],
  link: { propertyId: number } | { vehicleId: number },
  months: number,
  categories: Category[],
  asOf: Date = new Date(),
): Transaction[] {
  const categoriesById = new Map<number, Category>();
  for (const c of categories) if (c.id != null) categoriesById.set(c.id, c);

  const cutoff = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - months, asOf.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);

  return transactions
    .filter((t) => {
      if ('propertyId' in link && t.propertyId !== link.propertyId) return false;
      if ('vehicleId' in link && t.vehicleId !== link.vehicleId) return false;
      return t.date >= cutoff && isRealSpending(t, categoriesById);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Real-spending total for transactions linked to a property/vehicle within the
 * trailing `months` window. Sums `effectiveSpendingAmount` (nets out
 * reimbursements) over `linkedSpendingTransactions` to stay consistent with
 * the Dashboard's "Spending vs Budget" card.
 */
export function rollingExpense(
  transactions: Transaction[],
  link: { propertyId: number } | { vehicleId: number },
  months: number,
  categories: Category[],
  asOf: Date = new Date(),
): number {
  return linkedSpendingTransactions(transactions, link, months, categories, asOf)
    .reduce((s, t) => s + effectiveSpendingAmount(t), 0);
}

/**
 * ALL real-spending transactions linked to a property/vehicle, with no time
 * window. Used by the "annual average" and "average monthly utilities/gas"
 * cards to amortize over the user's full history of linked spending.
 */
export function allLinkedSpending(
  transactions: Transaction[],
  link: { propertyId: number } | { vehicleId: number },
  categories: Category[],
): Transaction[] {
  const categoriesById = new Map<number, Category>();
  for (const c of categories) if (c.id != null) categoriesById.set(c.id, c);
  return transactions.filter((t) => {
    if ('propertyId' in link && t.propertyId !== link.propertyId) return false;
    if ('vehicleId' in link && t.vehicleId !== link.vehicleId) return false;
    return isRealSpending(t, categoriesById);
  });
}

/**
 * Average monthly effective spend across a pre-filtered set of transactions.
 *
 * Span is measured from the earliest tx month to `asOf`'s month, inclusive
 * of both endpoints (e.g., Jan 2026 → Jan 2026 = 1 month; Jan 2026 → Mar
 * 2026 = 3 months). An empty set returns 0; a single-month set divides by 1.
 *
 * The Property/Vehicle "Expenses" card multiplies the result by 12 for the
 * "annual average" stat; the "Utilities" / "Gas" card uses the monthly value
 * directly after filtering to those categories.
 */
export function averageMonthlySpending(
  transactions: Transaction[],
  asOf: Date = new Date(),
): number {
  if (transactions.length === 0) return 0;
  let earliest = transactions[0].date;
  for (const t of transactions) if (t.date < earliest) earliest = t.date;
  const e = new Date(`${earliest}T00:00:00Z`);
  const months = Math.max(
    1,
    (asOf.getUTCFullYear() - e.getUTCFullYear()) * 12 +
      (asOf.getUTCMonth() - e.getUTCMonth()) +
      1,
  );
  const total = transactions.reduce((s, t) => s + effectiveSpendingAmount(t), 0);
  return total / months;
}
