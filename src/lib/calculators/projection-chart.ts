import { balanceTrajectory } from '@/lib/projection-trajectory';
import { toRealSeries } from '@/lib/calculators/real-mode';
import type { ChartDisplayMode } from '@/lib/calculators/use-chart-display-mode';

export interface ProjectionChartInput {
  pv: number;
  /** Annual contribution along each trajectory (0 for CoastFI's "stop contributing"). */
  annualContribution: number;
  /** Target in TODAY's dollars (annualExpenses·12 / SWR — a REAL figure). */
  targetFv: number;
  scenarios: ReadonlyArray<{ label: string; rate: number }>;
  /** Annual inflation fraction — the SAME resolver output the card's Real toggle uses. */
  inflation: number;
  displayMode: ChartDisplayMode;
  /** Integer years to chart (>= 0). Rows cover year 0..horizon inclusive. */
  horizon: number;
}

/**
 * Rows for the FI / CoastFI projection charts: one row per year carrying a
 * `year`, a `target`, and one key per scenario label. Single source for both
 * cards so the target-line basis cannot drift per-card.
 *
 * Target-line basis (wave-1 review finding 4 — the 4th nominal-on-real
 * instance in this app): `targetFv` is a today's-dollars (REAL) figure while
 * scenario trajectories are NOMINAL. A flat target under nominal trajectories
 * crosses years too early. So the NOMINAL view grows the target by
 * (1+inflation)^t — the nominal dollars that buy the same retirement at year
 * t — and the REAL view deflates trajectories AND the grown target, landing
 * the target exactly flat at `targetFv`. Both views therefore cross in the
 * SAME year, which matches the tables' real-rate solves.
 */
export function buildProjectionChartData(
  input: ProjectionChartInput,
): Record<string, number>[] {
  const trajectories = input.scenarios.map((s) => ({
    label: s.label,
    pts: balanceTrajectory(input.pv, input.annualContribution, s.rate, input.horizon),
  }));
  const nominal = Array.from({ length: input.horizon + 1 }, (_, t) => {
    const point: Record<string, number> = {
      year: t,
      target: input.targetFv * Math.pow(1 + input.inflation, t),
    };
    for (const tr of trajectories) point[tr.label] = tr.pts[t].balance;
    return point;
  });
  if (input.displayMode === 'NOMINAL') return nominal;
  return toRealSeries(nominal, input.inflation, {
    valueKeys: [...input.scenarios.map((s) => s.label), 'target'],
    yearKey: 'year',
  });
}
