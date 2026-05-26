import { projectScenario, type MonthlyState } from './engine';
import type { LeverPayload } from './lever-types';
import type { RealState } from './state-snapshot';

/**
 * Compute the "what would auto-invest right now" preview amount used by the
 * Contributions popover and lever-bar pill (Task #25).
 *
 * Defined as: income − expenses − loan payments at the FIRST stepped month
 * (monthIndex = 1) of the projection. This mirrors the engine's actual
 * routing for the empty-contributions case — when no explicit segment is
 * active and the monthly surplus is positive, ALL of it lands in
 * investments via the auto-invest path.
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
  // Strip contributions so the engine reports the "what would auto-invest"
  // value. Two months: seed + one step. The seed itself does NOT step
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
    return Math.max(0, states[1].autoInvestedSalarySurplus ?? 0);
  } catch {
    return 0;
  }
}
