/**
 * Round-2 A4: an excluded-from-net-worth property (or vehicle) whose linked
 * loan still counts as a liability produces a misleading negative net-worth
 * contribution. The VALUATION deliberately does not change this wave
 * (link-exclusion is an owner-level modeling decision) — instead the input
 * surfaces disclose the asymmetry. This helper answers "does this loan's
 * collateral sit outside net worth?" for the Loans-tab badge.
 *
 * Both link directions are honored: the property→loan edge
 * (property.linkedLoanId, set on PropertyForm) and the loan→asset edges
 * (loan.linkedPropertyId / loan.linkedVehicleId, set on LoanForm) — the
 * schema stores all three and the UI lets users set either side.
 * Structural pick-types keep the helper test-friendly and decoupled from
 * the full zod schemas.
 */
export function loanHasExcludedCollateral(
  loan: { id?: number | null; linkedPropertyId: number | null; linkedVehicleId: number | null },
  properties: ReadonlyArray<{ id?: number | null; linkedLoanId: number | null; excludedFromNetWorth: boolean }>,
  vehicles: ReadonlyArray<{ id?: number | null; excludedFromNetWorth: boolean }>,
): boolean {
  const viaProperty = properties.some(
    (p) =>
      p.excludedFromNetWorth &&
      p.id != null &&
      ((loan.linkedPropertyId != null && p.id === loan.linkedPropertyId) ||
        (loan.id != null && p.linkedLoanId != null && p.linkedLoanId === loan.id)),
  );
  if (viaProperty) return true;
  return vehicles.some(
    (v) => v.excludedFromNetWorth && v.id != null && loan.linkedVehicleId != null && v.id === loan.linkedVehicleId,
  );
}
