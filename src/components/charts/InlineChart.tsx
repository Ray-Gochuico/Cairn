import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_PALETTE } from './palette';
import { CHART_TOOLTIP_PROPS } from './ChartTooltip';
import { ChartLegend } from './ChartLegend';

const GRID_STROKE = 'hsl(var(--border))';
const AXIS_STROKE = 'hsl(var(--muted-foreground))';
const AXIS_TICK = { fill: AXIS_STROKE };
// Wave-12 D3 discipline: --blaze is fill/stroke only, never text.
const HERO = 'hsl(var(--blaze))';

export interface InlineChartPoint {
  [key: string]: number | string;
}

export interface InlineChartSeries {
  dataKey: string;
  label: string;
  color?: string;
  strokeDasharray?: string;
  strokeWidth?: number;
  /**
   * Single-hero identity stroke (Wave-12 D8 idiom): blaze color, 2.5px,
   * cairn terminal marker on the last data point. Use for exactly ONE
   * series per chart — the headline trajectory.
   */
  hero?: boolean;
}

export interface InlineChartMarker {
  x: string | number;
  y: number;
  color: string;
}

interface InlineChartProps {
  /** Small section label (muted, xs) — NOT a card title. Omit for none. */
  label?: string;
  height?: number;
  data: InlineChartPoint[];
  xKey: string;
  series: InlineChartSeries[];
  yFormatter?: (value: number) => string;
  markers?: InlineChartMarker[];
  testId?: string;
}

/**
 * Terminal cairn marker — geometry mirrors AssetValueChart's CAIRN_END_DOT
 * (Wave-12 signature). Deliberately STATIC (D14): InlineChart re-renders on
 * every input keystroke, so a fade here would be per-keystroke noise; zero
 * animation ⇒ zero motion-safe surface. Module constant for stable `shape`
 * identity.
 */
const CAIRN_TERMINAL = function CairnTerminal(props: { cx?: number; cy?: number }) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill={HERO} fillOpacity={0.15} />
      <rect x={cx - 1.75} y={cy - 4.6} width={3.5} height={2.4} rx={1.2} fill={HERO} />
      <rect x={cx - 2.75} y={cy - 1.7} width={5.5} height={2.7} rx={1.35} fill={HERO} />
      <rect x={cx - 3.5} y={cy + 1.5} width={7} height={3} rx={1.5} fill={HERO} />
    </g>
  );
};

/**
 * Bare (non-Card) chart shell for embedding INSIDE calculator workbenches
 * (Wave 18). LineChartCard's full Card chrome nested inside CalculatorCard
 * was a card-in-card; this is the same furniture without the frame.
 */
export function InlineChart({
  label,
  height = 220,
  data,
  xKey,
  series,
  yFormatter,
  markers,
  testId,
}: InlineChartProps) {
  const last = data.length > 0 ? data[data.length - 1] : null;
  return (
    <div className="min-w-0" data-testid={testId}>
      {label != null && (
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
          {label}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey={xKey} stroke={AXIS_STROKE} fontSize={12} tick={AXIS_TICK} />
          <YAxis
            stroke={AXIS_STROKE}
            fontSize={12}
            tick={AXIS_TICK}
            tickFormatter={yFormatter}
            width={yFormatter ? 64 : 48}
          />
          <Tooltip
            {...CHART_TOOLTIP_PROPS}
            formatter={
              yFormatter
                ? (value) => (typeof value === 'number' ? yFormatter(value) : String(value ?? ''))
                : undefined
            }
          />
          {series.length > 1 && <Legend content={<ChartLegend />} />}
          {series.map((s, idx) => (
            <Line
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.label}
              stroke={s.hero ? HERO : (s.color ?? CHART_PALETTE[idx % CHART_PALETTE.length])}
              strokeWidth={s.strokeWidth ?? (s.hero ? 2.5 : 2)}
              strokeDasharray={s.strokeDasharray}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
          {markers?.map((m, i) => (
            <ReferenceDot
              key={`marker-${i}`}
              x={m.x}
              y={m.y}
              r={4}
              fill={m.color}
              stroke="hsl(var(--background))"
              strokeWidth={1.5}
            />
          ))}
          {last != null &&
            series
              .filter((s) => s.hero && typeof last[s.dataKey] === 'number')
              .map((s) => (
                <ReferenceDot
                  key={`hero-end-${s.dataKey}`}
                  x={last[xKey]}
                  y={last[s.dataKey] as number}
                  shape={CAIRN_TERMINAL}
                />
              ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
