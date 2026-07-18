import { CHART_PALETTE, CHART_NEUTRAL } from '@/components/charts/palette';

/**
 * FI chart series semantics (Wave 11 T13). The scenario order is
 * Conservative, Moderate, Optimistic (household.growthScenarios order). Colours
 * are pinned so the Optimistic (best-case) trajectory NEVER wears the palette
 * red — a green growth line reading as danger is the finding this fixes. The
 * Moderate scenario drives the headline, so it is emphasized (2.5px, solid).
 */
export interface FiSeriesDef {
  dataKey: string;
  label: string;
  color: string;
  strokeDasharray?: string;
  strokeWidth: number;
}

export interface FiMarker {
  x: number;
  y: number;
  color: string;
}

// index 0 Conservative → blue, 1 Moderate → orange (headline), 2 Optimistic → green.
const SCENARIO_COLORS = [CHART_PALETTE[0], CHART_PALETTE[1], CHART_PALETTE[4]];
const SCENARIO_DASH: Array<string | undefined> = ['5 5', undefined, '2 2'];
const MODERATE_INDEX = 1;

export function fiChartSeries(
  scenarios: ReadonlyArray<{ label: string }>,
  chartData: ReadonlyArray<Record<string, number>>,
  target: number,
  // Wave 15 T4: CoastFI shares these series semantics but keeps its more
  // descriptive target label ('Required at retirement'). Default unchanged.
  opts?: { targetLabel?: string },
): { series: FiSeriesDef[]; markers: FiMarker[] } {
  const series: FiSeriesDef[] = scenarios.map((s, i) => ({
    dataKey: s.label,
    label: s.label,
    color: SCENARIO_COLORS[i] ?? CHART_PALETTE[i % CHART_PALETTE.length],
    strokeDasharray: SCENARIO_DASH[i],
    strokeWidth: i === MODERATE_INDEX ? 2.5 : 1.5,
  }));
  // Target reference series — neutral, dotted, never emphasized.
  series.push({
    dataKey: 'target',
    label: opts?.targetLabel ?? 'Target',
    color: CHART_NEUTRAL,
    strokeDasharray: '2 2',
    strokeWidth: 1.5,
  });

  // One crossing marker per scenario that first meets or exceeds the target.
  // Compares against each row's OWN target value when present (the target line
  // follows the real/nominal display basis, so a scalar comparison would
  // mis-time crossings in nominal mode — the nominal-on-real bug class); falls
  // back to the scalar `target` otherwise. The marker sits on the target line.
  const markers: FiMarker[] = [];
  for (let i = 0; i < scenarios.length; i++) {
    const def = series[i];
    const crossing = chartData.find(
      (row) => Number(row[def.dataKey]) >= (row.target ?? target),
    );
    if (crossing) {
      markers.push({ x: Number(crossing.year), y: Number(crossing.target ?? target), color: def.color });
    }
  }
  return { series, markers };
}
