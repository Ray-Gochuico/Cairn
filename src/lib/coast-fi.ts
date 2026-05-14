export interface CoastFiInput {
  requiredAtRetirement: number;
  annualRate: number;
  yearsUntilRetirement: number;
}

/**
 * Compute the amount needed today, untouched, to grow to the required
 * retirement balance at the given rate over the given horizon.
 *
 *   coast_fi_today = required_at_retirement / (1 + r) ^ years_until_retirement
 */
export function coastFi(input: CoastFiInput): number {
  return (
    input.requiredAtRetirement /
    Math.pow(1 + input.annualRate, input.yearsUntilRetirement)
  );
}
