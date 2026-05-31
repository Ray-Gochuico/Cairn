/**
 * Final take-home subtraction for the Paycheck Calculator (v1.1).
 *
 * Pure. Kept separate from computeTotalTax (which is tax-only and shared by
 * the bonus/commission/withdrawal calcs) because post-tax deductions and
 * extra W-4 withholding are paycheck-presentation concerns — they reduce
 * take-home AFTER tax and never change taxable income or bracket math.
 *
 * All amounts are ANNUAL. Per-paycheck inputs (e.g. extra federal withholding
 * entered "$/paycheck") must be annualized by the page (× periodsPerYear)
 * before being summed into extraWithholdingTotal.
 */
export interface TakeHomeInput {
  /** Annual gross wages. */
  gross: number;
  /** Sum of pre-tax deductions (401k, health, HSA, DCFSA, FSA), annual. */
  pretaxTotal: number;
  /** Federal + FICA + state + city tax, annual (from computeTotalTax). */
  taxTotal: number;
  /** Roth 401(k) + other post-tax (e.g. ESPP), annual. */
  postTaxTotal: number;
  /** Extra W-4 withholding (federal [+ state/city if added later]), annual. */
  extraWithholdingTotal: number;
}

export function computeTakeHome(input: TakeHomeInput): number {
  return Math.max(
    0,
    input.gross -
      input.pretaxTotal -
      input.taxTotal -
      input.postTaxTotal -
      input.extraWithholdingTotal,
  );
}
