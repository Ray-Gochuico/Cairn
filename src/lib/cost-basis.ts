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
        capitalIds.has(t.categoryId),
    )
    .reduce((s, t) => s + t.amount, 0);
  return (purchasePrice ?? 0) + improvements;
}

/**
 * Real-spending total for transactions linked to a property/vehicle within the
 * trailing `months` window. Uses `isRealSpending` (excludes pending
 * reimbursables and INCOME/TRANSFER-category rows) and sums
 * `effectiveSpendingAmount` (nets out reimbursements) to stay consistent with
 * the Dashboard's "Spending vs Budget" card.
 */
export function rollingExpense(
  transactions: Transaction[],
  link: { propertyId: number } | { vehicleId: number },
  months: number,
  categories: Category[],
  asOf: Date = new Date(),
): number {
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
    .reduce((s, t) => s + effectiveSpendingAmount(t), 0);
}
