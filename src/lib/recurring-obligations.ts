import type { HousingPayment, VehicleLease } from '@/types/schema';

/**
 * Pure helpers for summing recurring monthly obligations (rent + leases) on
 * a given as-of ISO date. Consumed by:
 *   - the Spending page "Recurring obligations" tile (current month)
 *   - the Property / Vehicles page per-page aggregate cards
 *   - the What-If projection engine (per projection month — so a lease that
 *     ends mid-projection stops contributing without the user manually
 *     deleting the row)
 *
 * The single source-of-truth means "active on month X" logic does not drift
 * across surfaces.
 */

interface DateRange {
  startDate: string; // ISO YYYY-MM-DD
  endDate: string | null;
}

/**
 * Inclusive on both ends. Comparison is lexicographic, which is correct
 * for `YYYY-MM-DD` strings (the schema enforces that format).
 */
export function isActiveOn(item: DateRange, asOfISO: string): boolean {
  if (asOfISO < item.startDate) return false;
  if (item.endDate != null && asOfISO > item.endDate) return false;
  return true;
}

export function monthlyHousingObligation(
  housingPayments: HousingPayment[],
  asOfISO: string,
): number {
  return housingPayments
    .filter((p) => isActiveOn(p, asOfISO))
    .reduce((s, p) => s + p.monthlyAmount, 0);
}

export function monthlyLeaseObligation(
  vehicleLeases: VehicleLease[],
  asOfISO: string,
): number {
  return vehicleLeases
    .filter((l) => isActiveOn(l, asOfISO))
    .reduce((s, l) => s + l.monthlyAmount, 0);
}

export function monthlyRecurringObligation(
  housingPayments: HousingPayment[],
  vehicleLeases: VehicleLease[],
  asOfISO: string,
): number {
  return (
    monthlyHousingObligation(housingPayments, asOfISO) +
    monthlyLeaseObligation(vehicleLeases, asOfISO)
  );
}
