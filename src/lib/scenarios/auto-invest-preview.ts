import { projectScenario, type MonthlyState } from './engine';
import type { LeverPayload } from './lever-types';
import type { RealState } from './state-snapshot';

export interface SurplusFlowBreakdown {
  /** Total monthly surplus (income − expenses − loan payments) at month 1, with segments stripped. */
  amount: number;
  /** Amount routed into tax-advantaged accounts per the current scenario's gapAllocation. */
  taxAdvantaged: number;
  /** Amount routed into brokerage / taxable accounts. */
  brokerage: number;
  /** Amount that flows to cash (whether explicit or default-overflow). */
  cash: number;
}

/**
 * Compute the "where does my surplus go right now" preview used by the
 * Contributions popover, the LeverBar pill, and any other UI surface.
 *
 * Per-bucket breakdown (rewritten 2026-05-26 revamp). Strips contribution
 * segments before projecting so the user sees the "if you had no segment,
 * here's what the engine would do" amount. Other levers stay intact so the
 * surplus reflects the user's current income / expense / loan / inflation
 * configuration AND their gapAllocation.
 *
 * Returns zeros (never negative) when the surplus is non-positive, the real
 * state hasn't loaded, or the projection throws.
 */
export function currentSurplusFlow(
  real: RealState,
  payload: LeverPayload,
): SurplusFlowBreakdown {
  const previewPayload: LeverPayload = { ...payload, contributions: [] };
  // Normalize startISO to YYYY-MM. captureRealState produces YYYY-MM but
  // some test fixtures pass the YYYY-MM-DD form. The engine's addMonths
  // expects month-precision, so we slice defensively here. Wrap in a
  // try/catch so a malformed RealState degrades to "no preview" rather
  // than crashing the popover render.
  const startISO = real.startISO.slice(0, 7);
  try {
    const states: MonthlyState[] = projectScenario(real, previewPayload, {
      startISO,
      months: 2,
    });
    if (states.length < 2) return { amount: 0, taxAdvantaged: 0, brokerage: 0, cash: 0 };
    const m1 = states[1];
    const taxAdvantaged = Math.max(0, m1.gapToTaxAdvantaged ?? 0);
    const brokerage     = Math.max(0, m1.gapToBrokerage ?? 0);
    const cash          = Math.max(0, m1.gapToCash ?? 0);
    const amount        = taxAdvantaged + brokerage + cash;
    return { amount, taxAdvantaged, brokerage, cash };
  } catch {
    return { amount: 0, taxAdvantaged: 0, brokerage: 0, cash: 0 };
  }
}

/**
 * Backwards-compat alias for the v0 import name. Returns the new
 * `SurplusFlowBreakdown` object — call sites that previously treated the
 * return value as a scalar `number` must migrate to read `.amount`. The plan
 * intentionally chose this shape (vs keeping a separate scalar export) so
 * the TypeScript surface forces an explicit migration at each call site.
 *
 * Will be deleted in a follow-up cleanup once every caller uses
 * {@link currentSurplusFlow} directly.
 */
export const currentMonthlySalarySurplus = currentSurplusFlow;
