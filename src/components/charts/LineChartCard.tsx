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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CHART_PALETTE } from './palette';
import { CHART_TOOLTIP_PROPS } from './ChartTooltip';
import { ChartLegend } from './ChartLegend';

// CSS-variable references so axes / grid flip with the theme (Wave-3
// Design must-have #2).
const GRID_STROKE = 'hsl(var(--border))';
const AXIS_STROKE = 'hsl(var(--muted-foreground))';
const AXIS_TICK = { fill: AXIS_STROKE };

export interface LineChartPoint {
  [key: string]: number | string;
}

export interface LineChartSeries {
  dataKey: string;
  label: string;
  color?: string;
  /**
   * Optional SVG stroke-dasharray pattern (e.g. "5 5" for dashed, "2 2" for
   * dotted). Default: undefined → solid line. Opt-in only — existing consumers
   * that do not set this field render identically (solid) to their prior
   * behaviour (WCAG 1.4.1 additive fix; Charts Fence: additive/opt-in).
   */
  strokeDasharray?: string;
  /** Optional emphasis width (default 2). The FI card drives the headline
   * Moderate line at 2.5 (Wave 11 T13). */
  strokeWidth?: number;
}

/** A target-crossing marker rendered as a ReferenceDot (Wave 11 T13). */
export interface LineChartMarker {
  x: string | number;
  y: number;
  color: string;
}

export interface LineChartCardProps {
  title: string;
  subtitle?: string;
  height?: number;
  data: LineChartPoint[];
  xKey: string;
  series: LineChartSeries[];
  yFormatter?: (value: number) => string;
  markers?: LineChartMarker[];
}

export default function LineChartCard({
  title,
  subtitle,
  height = 240,
  data,
  xKey,
  series,
  yFormatter,
  markers,
}: LineChartCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
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
                  ? (value) =>
                      typeof value === 'number' ? yFormatter(value) : String(value ?? '')
                  : undefined
              }
            />
            <Legend content={<ChartLegend />} />
            {series.map((s, idx) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.label}
                stroke={s.color ?? CHART_PALETTE[idx % CHART_PALETTE.length]}
                strokeWidth={s.strokeWidth ?? 2}
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
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
