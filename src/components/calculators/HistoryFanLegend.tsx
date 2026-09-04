import { FAN_LEGEND_BAND, FAN_LEGEND_MEDIAN } from '@/lib/calculators/history-fan-copy';

const BAND_FILL = 'hsl(var(--chart-band))';
const MEDIAN_STROKE = 'hsl(var(--foreground))';

/** The chart's own line-series config (InlineChartSeries, structurally) — the
 *  legend reads label and colour from it so the key can never drift from the
 *  line it names. */
export interface HistoryFanLegendSeries {
  dataKey: string;
  label: string;
  color?: string;
  strokeDasharray?: string;
  strokeWidth?: number;
}

/** CH-9 / D-P3: hand-rolled fan legend — the BacktestChart bandsLegend idiom
 *  at card scale. It is the ONLY legend under a fan chart: InlineChart
 *  suppresses recharts' own legend whenever `fan` is set (a custom legend
 *  `content` never sees recharts' `legendType="none"` filter, so the fan keys
 *  used to leak there). Swatch opacity matches the fill (0.28). The chart's
 *  line series are appended after the band + median entries — the median line
 *  is already the second entry, so a series carrying that label is skipped. */
export function HistoryFanLegend({
  series = [],
}: {
  series?: ReadonlyArray<HistoryFanLegendSeries>;
} = {}) {
  const lines = series.filter((s) => s.label !== FAN_LEGEND_MEDIAN);
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2"
      data-testid="history-fan-legend"
    >
      <span className="flex items-center gap-1">
        <span
          className="inline-block w-6 h-3 rounded-sm"
          style={{ background: BAND_FILL, opacity: 0.28 }}
        />
        {FAN_LEGEND_BAND}
      </span>
      <span className="flex items-center gap-1">
        <svg width="24" height="8" aria-hidden>
          <line x1="0" y1="4" x2="24" y2="4" stroke={MEDIAN_STROKE} strokeWidth={2.5} />
        </svg>
        {FAN_LEGEND_MEDIAN}
      </span>
      {lines.map((s) => (
        <span key={s.dataKey} className="flex items-center gap-1">
          <svg width="24" height="8" aria-hidden data-series={s.dataKey}>
            <line
              x1="0"
              y1="4"
              x2="24"
              y2="4"
              stroke={s.color ?? MEDIAN_STROKE}
              strokeWidth={s.strokeWidth ?? 2}
              strokeDasharray={s.strokeDasharray}
            />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}
