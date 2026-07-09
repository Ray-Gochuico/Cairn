import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
// Design must-have #2). ProjectionChart established the pattern; chart
// cards now mirror it.
const GRID_STROKE = 'hsl(var(--border))';
const AXIS_STROKE = 'hsl(var(--muted-foreground))';
const AXIS_TICK = { fill: AXIS_STROKE };

export interface BarChartPoint {
  [key: string]: number | string;
}

export interface BarChartSeries {
  dataKey: string;
  label: string;
  color?: string;
  /**
   * Optional Recharts stackId. Series sharing the same stackId stack on top
   * of each other. Omit to draw side-by-side bars (default).
   */
  stackId?: string;
}

export interface BarChartCardProps {
  title: string;
  subtitle?: string;
  height?: number;
  data: BarChartPoint[];
  xKey: string;
  series: BarChartSeries[];
  yFormatter?: (value: number) => string;
  layout?: 'horizontal' | 'vertical';
  /**
   * Override recharts' default 'preserveStartEnd' x-axis tick interval.
   * Pass 0 to show all ticks (useful for monthly data where every month
   * label should appear). Omit to use recharts' default behaviour.
   */
  xAxisInterval?: number | 'preserveStartEnd' | 'preserveStart' | 'preserveEnd';
  /**
   * Override the x-axis tick formatter (e.g. to shorten 'YYYY-MM' → 'Jan').
   * Omit to display the raw x-axis value.
   */
  xTickFormatter?: (value: unknown) => string;
  /**
   * Centered guidance copy shown INSTEAD of the chart when there is no data
   * (or every series value is 0) — a bar chart of all-zero rows reads as a
   * blank grid otherwise (Wave 11 T11).
   */
  emptyMessage?: string;
}

// Long PDF-extracted merchant strings, category names, etc. overflow the
// y-axis label area in vertical layouts. Truncate to this many chars and
// suffix an ellipsis so each tick fits inside YAXIS_VERTICAL_WIDTH.
const VERTICAL_TICK_MAX_CHARS = 22;
const YAXIS_VERTICAL_WIDTH = 160;
// Each bar needs ~32px of vertical space to render with its label legible;
// short datasets reuse the default `height`, longer ones grow to fit.
const ROW_HEIGHT_PX = 32;
const VERTICAL_HEIGHT_PADDING_PX = 80;

function truncateTick(value: unknown): string {
  const s = String(value ?? '');
  return s.length > VERTICAL_TICK_MAX_CHARS
    ? `${s.slice(0, VERTICAL_TICK_MAX_CHARS - 1)}…`
    : s;
}

export default function BarChartCard({
  title,
  subtitle,
  height = 240,
  data,
  xKey,
  series,
  yFormatter,
  layout = 'horizontal',
  xAxisInterval,
  xTickFormatter,
  emptyMessage,
}: BarChartCardProps) {
  const isVertical = layout === 'vertical';
  const effectiveHeight = isVertical
    ? Math.max(height, data.length * ROW_HEIGHT_PX + VERTICAL_HEIGHT_PADDING_PX)
    : height;
  const hasAnyValue =
    data.length > 0 && data.some((row) => series.some((s) => Number(row[s.dataKey]) !== 0));
  if (!hasAnyValue && emptyMessage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <div
            className="flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
            style={{ height: effectiveHeight }}
          >
            {emptyMessage}
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={effectiveHeight}>
          <BarChart
            data={data}
            layout={layout}
            margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
          >
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            {isVertical ? (
              <>
                <XAxis
                  type="number"
                  stroke={AXIS_STROKE}
                  fontSize={12}
                  tick={AXIS_TICK}
                  tickFormatter={yFormatter}
                />
                <YAxis
                  type="category"
                  dataKey={xKey}
                  stroke={AXIS_STROKE}
                  fontSize={12}
                  tick={AXIS_TICK}
                  width={YAXIS_VERTICAL_WIDTH}
                  interval={0}
                  tickFormatter={truncateTick}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey={xKey}
                  stroke={AXIS_STROKE}
                  fontSize={12}
                  tick={AXIS_TICK}
                  {...(xAxisInterval !== undefined ? { interval: xAxisInterval } : {})}
                  {...(xTickFormatter !== undefined ? { tickFormatter: xTickFormatter } : {})}
                />
                <YAxis
                  stroke={AXIS_STROKE}
                  fontSize={12}
                  tick={AXIS_TICK}
                  tickFormatter={yFormatter}
                  width={yFormatter ? 64 : 48}
                />
              </>
            )}
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
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label}
                stackId={s.stackId}
                fill={s.color ?? CHART_PALETTE[idx % CHART_PALETTE.length]}
                radius={[2, 2, 0, 0]}
                // Same recharts useAnimationId(props) churn that hits Pie also
                // hits Bar — its key={animationId} on <JavascriptAnimate>
                // remounts every render and loops via setIsAnimating. Mirrors
                // ProjectionChart's stance.
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
