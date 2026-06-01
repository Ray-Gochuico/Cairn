export interface TrajectoryPoint {
  year: number;
  balance: number;
}

/**
 * Year-by-year future-value series for years 0..years (inclusive).
 * balance(t) = pv·(1+r)^t + pmt·((1+r)^t − 1)/r   (r=0 → pv + pmt·t).
 * FI passes pmt = annual contribution; CoastFI passes pmt = 0 (the "stop
 * contributing" coast). Mirrors the FV math `yearsToFi` inverts.
 */
export function balanceTrajectory(
  pv: number,
  pmt: number,
  rate: number,
  years: number,
): TrajectoryPoint[] {
  const pts: TrajectoryPoint[] = [];
  for (let t = 0; t <= years; t++) {
    const balance =
      rate === 0
        ? pv + pmt * t
        : pv * Math.pow(1 + rate, t) + (pmt * (Math.pow(1 + rate, t) - 1)) / rate;
    pts.push({ year: t, balance });
  }
  return pts;
}
