import { projectScenario, type MonthlyState } from './engine';
import type { LeverPayload } from './lever-types';
import type { RealState } from './state-snapshot';

/**
 * Compute the "what would the monthly surplus be right now" preview amount
 * used by the Contributions popover and lever-bar pill (Task #25). Surfaces
 * the magnitude of the income − expenses − loan-payments flow that
 * `stepMonth` would route either to investments (autoInvestSalarySurplus ON)
 * or to cash (OFF, migration 0029).
 *
 * Defined as: income − expenses − loan payments at the FIRST stepped month
 * (monthIndex = 1) of the projection. This mirrors the engine's actual
 * routing for the empty-contributions case — when no explicit segment is
 * active and the monthly surplus is positive, ALL of it lands in either
 * investments (ON branch → `autoInvestedSalarySurplus`) or cash (OFF branch
 * → `salarySurplusToCash`). We sum the two so the preview is invariant to
 * the household setting: it always reports the positive-surplus magnitude.
 *
 * To stay independent of whether the user has configured any contribution
 * segments today, we run the engine with the segments STRIPPED. That gives
 * a stable "auto-invest if you had no segments" preview the UI can surface
 * even when the user is mid-edit. The returns / lump-sums / income /
 * expenses / loan-payment levers stay intact so the surplus reflects the
 * user's other configured levers.
 *
 * Returns 0 (never negative) — a negative surplus is not "auto-invested";
 * the engine treats it as a cash-floor shortfall (potentially withdrawing
 * from investments). The preview surfaces only the positive-flow case.
 */
export function currentMonthlySalarySurplus(
  real: RealState,
  payload: LeverPayload,
): number {
  // Strip contributions so the engine reports the "what would the surplus
  // be" value. Two months: seed + one step. The seed itself does NOT step
  // through stepMonth (the optional fields are undefined on month 0),
  // which is fine — we want the value AT month 1.
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
    if (states.length < 2) return 0;
    // Sum both routing destinations — exactly one is non-zero per step
    // (the engine's else-if branching guarantees this). This makes the
    // helper invariant to the household's auto-invest setting.
    const investBranch = states[1].autoInvestedSalarySurplus ?? 0;
    const cashBranch = states[1].salarySurplusToCash ?? 0;
    return Math.max(0, investBranch + cashBranch);
  } catch {
    return 0;
  }
}
