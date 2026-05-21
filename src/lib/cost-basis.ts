import type { Transaction, Category } from '@/types/schema';

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
 * Σ positive-amount transactions linked to a property/vehicle within the
 * trailing `months` window.
 */
export function rollingExpense(
  transactions: Transaction[],
  link: { propertyId: number } | { vehicleId: number },
  months: number,
  asOf: Date = new Date(),
): number {
  const cutoff = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - months, asOf.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  return transactions
    .filter((t) => {
      if ('propertyId' in link && t.propertyId !== link.propertyId) return false;
      if ('vehicleId' in link && t.vehicleId !== link.vehicleId) return false;
      return t.amount > 0 && t.date >= cutoff;
    })
    .reduce((s, t) => s + t.amount, 0);
}
