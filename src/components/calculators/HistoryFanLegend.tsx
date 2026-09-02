import { FAN_LEGEND_BAND, FAN_LEGEND_MEDIAN } from '@/lib/calculators/history-fan-copy';

const BAND_FILL = 'hsl(var(--chart-band))';
const MEDIAN_STROKE = 'hsl(var(--foreground))';

/** CH-9 / D-P3: hand-rolled fan legend — the BacktestChart bandsLegend idiom
 *  at card scale (the recharts Legend never sees the fan: both Areas are
 *  legendType="none"). Swatch opacity matches the fill (0.28). */
export function HistoryFanLegend() {
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
    </div>
  );
}
