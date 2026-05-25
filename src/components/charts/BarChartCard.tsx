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
}: BarChartCardProps) {
  const isVertical = layout === 'vertical';
  const effectiveHeight = isVertical
    ? Math.max(height, data.length * ROW_HEIGHT_PX + VERTICAL_HEIGHT_PADDING_PX)
    : height;
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            {isVertical ? (
              <>
                <XAxis
                  type="number"
                  stroke="#64748b"
                  fontSize={12}
                  tickFormatter={yFormatter}
                />
                <YAxis
                  type="category"
                  dataKey={xKey}
                  stroke="#64748b"
                  fontSize={12}
                  width={YAXIS_VERTICAL_WIDTH}
                  interval={0}
                  tickFormatter={truncateTick}
                />
              </>
            ) : (
              <>
                <XAxis dataKey={xKey} stroke="#64748b" fontSize={12} />
                <YAxis
                  stroke="#64748b"
                  fontSize={12}
                  tickFormatter={yFormatter}
                  width={yFormatter ? 64 : 48}
                />
              </>
            )}
            <Tooltip
              formatter={
                yFormatter
                  ? (value) =>
                      typeof value === 'number' ? yFormatter(value) : String(value ?? '')
                  : undefined
              }
            />
            <Legend />
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
