import type { Household } from '@/types/schema';
import type { Scenario } from '@/types/scenario';

/**
 * Resolves the effective Safe Withdrawal Rate for FI / Coast FI math
 * given a scenario (optional per-scenario override) and household
 * (per-household default). Falls back to 0.04 only when neither source
 * has a positive value — defensive against tests and cold-start.
 */
export function effectiveSwr(
  scenario: Scenario | null,
  household: Household | null,
): number {
  if (scenario?.leverPayload?.swrOverride != null) {
    return scenario.leverPayload.swrOverride;
  }
  if (household?.withdrawalRate != null && household.withdrawalRate > 0) {
    return household.withdrawalRate;
  }
  return 0.04;
}
