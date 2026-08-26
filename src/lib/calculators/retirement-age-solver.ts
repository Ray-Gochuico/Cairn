/**
 * W1 Earliest Retirement solver (D-R1..D-R3): inverts the PathToFi criterion
 * over INTEGER years with the search kept visible. Pure and date-free — the
 * component injects `ageNow` from `currentAge(dob)` and the UNFLOORED Fisher
 * real rate (T17 discipline: identical solve basis to PathToFi's KEEP mode).
 * No change to financial-independence.ts — `yearsToFi`'s closed form is this
 * module's test oracle (`answerT === ceil(yearsToFi)`), so the two cards can
 * never disagree (D-R4).
 *
 * Monotonicity (D-R2): d/dt FV = ln(1+r)·(pv + pmt/r)·(1+r)^t has a constant
 * sign for every r ≠ 0 (and the r = 0 limit pv + pmt·t is linear), so probing
 * tMax first classifies the whole range: a miss at tMax IS the exact
 * never-holds answer, not a search failure; a hold at tMax makes integer
 * bisection valid.
 */

/** The persons schema caps retirement age at 90 (src/types/schema.ts `.max(90)`). */
export const MAX_SOLVE_AGE = 90;

export type RetirementVerdict =
  | 'already-holds' // FV(0) ≥ target — nothing to solve (no probes)
  | 'age-found'     // bisection answer: answerT = first integer t that holds
  | 'not-by-max'    // tMax probe missed at a positive real rate (that one probe shown)
  | 'never-real'    // tMax probe missed at realRate ≤ 0 — the Wave-17 lock framing
  | 'past-max';     // ageNow ≥ maxAge — no search range exists

export interface RetirementSolveInput {
  ageNow: number;   // whole years (the currentAge convention), injected by the component
  pv: number;       // scenario-bar portfolio (today's dollars)
  pmt: number;      // scenario-bar annual contribution — assumed to continue until the found age
  realRate: number; // UNFLOORED Fisher real rate (fraction; may be ≤ 0)
  targetFv: number; // 12 × monthlyExpenses ÷ SWR, today's dollars
  maxAge: number;   // MAX_SOLVE_AGE
}

export interface RetirementProbe {
  t: number;        // years from now
  fv: number;       // projected real portfolio at t
  holds: boolean;   // fv ≥ targetFv
}

export interface RetirementSolveResult {
  verdict: RetirementVerdict;
  /** Integer years-from-now when the plan first holds; null unless 'age-found' (0 for 'already-holds'). */
  answerT: number | null;
  /** Every probe IN TESTED ORDER (D-R3) — the rendered rows. */
  probes: RetirementProbe[];
}

/** FV(t) = pv(1+r)^t + pmt((1+r)^t − 1)/r, with the exact r = 0 limit pv + pmt·t. */
export function projectedFv(pv: number, pmt: number, realRate: number, t: number): number {
  if (realRate === 0) return pv + pmt * t;
  const growth = Math.pow(1 + realRate, t);
  return pv * growth + (pmt * (growth - 1)) / realRate;
}

export function solveEarliestRetirement(input: RetirementSolveInput): RetirementSolveResult {
  const { ageNow, pv, pmt, realRate, targetFv, maxAge } = input;
  const tMax = maxAge - ageNow;
  if (tMax <= 0) return { verdict: 'past-max', answerT: null, probes: [] };
  if (projectedFv(pv, pmt, realRate, 0) >= targetFv) {
    return { verdict: 'already-holds', answerT: 0, probes: [] };
  }

  const probes: RetirementProbe[] = [];
  const probe = (t: number): boolean => {
    const fv = projectedFv(pv, pmt, realRate, t);
    const holds = fv >= targetFv;
    probes.push({ t, fv, holds });
    return holds;
  };

  // (2) Probe the far end first — a miss here is the exact verdict (D-R2).
  if (!probe(tMax)) {
    return { verdict: realRate <= 0 ? 'never-real' : 'not-by-max', answerT: null, probes };
  }

  // (3) Integer bisection: lo always fails (t = 0 checked above), hi always holds.
  let lo = 0;
  let hi = tMax;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (probe(mid)) hi = mid;
    else lo = mid;
  }
  return { verdict: 'age-found', answerT: hi, probes };
}
