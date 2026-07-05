export interface TrajectoryPoint {
  year: number;
  balance: number;
}

/**
 * Year-by-year future-value series for years 0..years (inclusive).
 *
 * With contributionGrowth g = 0 (the default):
 *   balance(t) = pv·(1+r)^t + pmt·((1+r)^t − 1)/r   (r=0 → pv + pmt·t)
 * — the FV math `yearsToFi` inverts for a NOMINAL-frame solve.
 *
 * With g > 0, the year-t contribution is pmt·(1+g)^t (end-of-year, matching
 * the ordinary-annuity timing of the closed form). Passing g = inflation
 * makes the contribution REAL-flat in the nominal frame — deflating the
 * result by (1+g)^t reproduces pv·(1+rr)^t + pmt·((1+rr)^t − 1)/rr at the
 * exact-Fisher real rate rr, i.e. the REAL-frame solve
 * `financialIndependenceSeries` runs (round-2 A3: the chart previously
 * compounded a flat-NOMINAL contribution, which undershoots a real-flat
 * one against the inflating target — the crossing landed years LATE vs
 * the table's answer). Computed by recursion for g ≠ 0; the g = 0 path
 * keeps the closed form so existing callers are bit-identical.
 *
 * FI passes pmt = annual contribution; CoastFI passes pmt = 0 (the "stop
 * contributing" coast — growth is irrelevant at pmt 0).
 */
export function balanceTrajectory(
  pv: number,
  pmt: number,
  rate: number,
  years: number,
  contributionGrowth = 0,
): TrajectoryPoint[] {
  const pts: TrajectoryPoint[] = [];
  if (contributionGrowth === 0) {
    for (let t = 0; t <= years; t++) {
      const balance =
        rate === 0
          ? pv + pmt * t
          : pv * Math.pow(1 + rate, t) + (pmt * (Math.pow(1 + rate, t) - 1)) / rate;
      pts.push({ year: t, balance });
    }
    return pts;
  }
  let balance = pv;
  pts.push({ year: 0, balance });
  for (let t = 1; t <= years; t++) {
    balance = balance * (1 + rate) + pmt * Math.pow(1 + contributionGrowth, t);
    pts.push({ year: t, balance });
  }
  return pts;
}
