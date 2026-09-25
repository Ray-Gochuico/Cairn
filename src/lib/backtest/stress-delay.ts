import { datasetReplayRows, flatPathEnd, replayWindow } from './replay';
import { STRESS_WINDOWS } from './windows';
import {
  MAX_SOLVE_AGE, solveEarliestRetirement, type RetirementVerdict,
} from '@/lib/calculators/retirement-age-solver';

/**
 * v1.7.0 R4 (coordinator ruling 2026-09-24): the two-leg FI-delay reading over
 * the five STRESS_WINDOWS as ONE shared pure module. The Roadmap's
 * market_stress thread reads it now; the Stress Test card (B3b memo) reuses
 * this exact function later, so the two surfaces can never disagree for the
 * same inputs. Plain inputs only — the REAL rate arrives already converted
 * (no converter is imported here: the kernel supplies it through effects.ts's
 * kernelScenario seam, the card through its own); no clock; no copy — every
 * string lives with its surface.
 *
 * Per window (F2d / ruling 5): leg A = flatPathEnd(pv, realRate, pmt, n) —
 * the replay's own yearly cadence, never projectedFv; leg B = the window's
 * end balance; both solved with solveEarliestRetirement from ageNow + n (the
 * window's LAST year); delay = tB − tA in whole years. Windows return in
 * REGISTRY order — never sorted. Verdicts are the solver's own; the uniform
 * states (never-real / not-by-max across every in-range window) are derived
 * here so a consumer never reinterprets a verdict.
 */
export interface StressDelayInput {
  pv: number;
  pmt: number;
  /** UNFLOORED Fisher real rate (fraction; may be ≤ 0). */
  realRate: number;
  /** null → no solve (no target). */
  targetFv: number | null;
  /** The OLDER subject's whole-year age; null → no solve (no person). */
  ageNow: number | null;
  /** Fraction 0..1 (the replay's convention; 0.75 = DEFAULT_STOCK_PCT). */
  stockPct: number;
  /** Defaults to MAX_SOLVE_AGE. */
  maxAge?: number;
}

export type StressSolverState = 'ok' | 'no-target' | 'no-age' | 'past-max-today' | 'never-real' | 'not-by-max';

export interface StressWindowNumerics {
  id: string;
  label: string;
  span: { startYear: number; endYear: number };
  n: number;
  troughBalance: number;
  troughYear: number;
  windowEndBalance: number;
  recoveredYear: number | null;
  /** troughBalance / pv − 1 (negative on a drawdown). */
  depth: number;
  /** The card's DP-15 rule: contributions > 0 and the trough never fell below pv. */
  outpaced: boolean;
  /** F2d: BOTH legs start at the window's last year. */
  legStartYear: number;
  /** flatPathEnd(pv, realRate, pmt, n) — the replay's cadence. */
  legAStart: number;
  /** windowEndBalance. */
  legBStart: number;
  /** ageNow + n. */
  solveAge: number;
  verdictA: RetirementVerdict | null;
  verdictB: RetirementVerdict | null;
  tA: number | null;
  tB: number | null;
  /** tB − tA when both legs found; else null. */
  delay: number | null;
}

export interface StressDelayResult {
  windows: StressWindowNumerics[];
  /** True when both legs were solved (a target, an age, and an age below the cap). */
  solverRan: boolean;
  solverState: StressSolverState;
  lastDataYear: number;
  maxAge: number;
}

export const isFoundVerdict = (v: RetirementVerdict | null): boolean => v === 'age-found' || v === 'already-holds';

export function computeStressDelays(input: StressDelayInput): StressDelayResult {
  const { pv, pmt, realRate, targetFv, ageNow, stockPct } = input;
  const maxAge = input.maxAge ?? MAX_SOLVE_AGE;
  const solverRan = targetFv != null && ageNow != null && ageNow < maxAge;
  const rows = datasetReplayRows(stockPct);
  const lastDataYear = rows[rows.length - 1].year;

  const windows: StressWindowNumerics[] = STRESS_WINDOWS.map((w) => {
    const r = replayWindow({ startBalance: pv, annualContribution: pmt, span: w.span, rows });
    const n = w.span.endYear - w.span.startYear + 1;
    const legAStart = flatPathEnd(pv, realRate, pmt, n);
    const legBStart = r.windowEndBalance;
    const solveAge = (ageNow ?? 0) + n;
    let verdictA: RetirementVerdict | null = null;
    let verdictB: RetirementVerdict | null = null;
    let tA: number | null = null;
    let tB: number | null = null;
    if (solverRan && targetFv != null) {
      const a = solveEarliestRetirement({ ageNow: solveAge, pv: legAStart, pmt, realRate, targetFv, maxAge });
      const b = solveEarliestRetirement({ ageNow: solveAge, pv: legBStart, pmt, realRate, targetFv, maxAge });
      verdictA = a.verdict; verdictB = b.verdict; tA = a.answerT; tB = b.answerT;
    }
    return {
      id: w.id, label: w.label, span: w.span, n,
      troughBalance: r.troughBalance, troughYear: r.troughYear, windowEndBalance: r.windowEndBalance,
      recoveredYear: r.recoveredYear, depth: r.troughBalance / pv - 1,
      outpaced: pmt > 0 && r.troughBalance >= pv,
      legStartYear: w.span.endYear, legAStart, legBStart, solveAge, verdictA, verdictB, tA, tB,
      delay: tA != null && tB != null ? tB - tA : null,
    };
  });

  let solverState: StressSolverState;
  if (targetFv == null) solverState = 'no-target';
  else if (ageNow == null) solverState = 'no-age';
  else if (ageNow >= maxAge) solverState = 'past-max-today';
  else {
    // The uniform states (ruling 2). Leg-A reachability does not depend on the
    // window (never-real is pv-independent; not-by-max at pmt 0 is
    // ceil(t* − n) + n = ceil(t*)), so "every in-range window" is the normal
    // case; a mixed state is a rounding edge left to the consumer, per line.
    const inRange = windows.filter((w) => w.solveAge < maxAge);
    solverState = inRange.length > 0 && inRange.every((w) => w.verdictA === 'never-real') ? 'never-real'
      : inRange.length > 0 && inRange.every((w) => w.verdictA === 'not-by-max') ? 'not-by-max'
        : 'ok';
  }
  return { windows, solverRan, solverState, lastDataYear, maxAge };
}
