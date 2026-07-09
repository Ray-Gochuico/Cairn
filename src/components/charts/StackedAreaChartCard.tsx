import {
  Area,
  AreaChart,
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
import { formatCompactCurrency } from '@/lib/format';

// CSS-variable references so axes / grid flip with the theme.
const GRID_STROKE = 'hsl(var(--border))';
const AXIS_STROKE = 'hsl(var(--muted-foreground))';
const AXIS_TICK = { fill: AXIS_STROKE };

export interface StackedAreaPoint {
  [key: string]: number | string;
}

export interface StackedAreaSeries {
  dataKey: string;
  label: string;
  color?: string;
}

export interface StackedAreaChartCardProps {
  title: string;
  subtitle?: string;
  height?: number;
  data: StackedAreaPoint[];
  xKey: string;
  series: StackedAreaSeries[];
  yFormatter?: (value: number) => string;
  xTickFormatter?: (value: unknown) => string;
  emptyMessage?: string;
}

/**
 * House stacked AREA card (Wave 11 T12) — mirrors BarChartCard's prop shape
 * and the hero-chart idiom (solid horizontal grid, quiet muted axes,
 * neutral-dot legend). A stacked area reads balance decay across a long
 * horizon where hundreds of sub-pixel monthly bars would be noise.
 */
export default function StackedAreaChartCard({
  title,
  subtitle,
  height = 240,
  data,
  xKey,
  series,
  yFormatter,
  xTickFormatter,
  emptyMessage,
}: StackedAreaChartCardProps) {
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
            style={{ height }}
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
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid vertical={false} stroke={GRID_STROKE} />
            <XAxis
              dataKey={xKey}
              stroke={AXIS_STROKE}
              fontSize={12}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              {...(xTickFormatter !== undefined ? { tickFormatter: xTickFormatter } : {})}
            />
            <YAxis
              stroke={AXIS_STROKE}
              fontSize={12}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={yFormatter ?? formatCompactCurrency}
              width={64}
            />
            <Tooltip
              {...CHART_TOOLTIP_PROPS}
              formatter={(value) =>
                typeof value === 'number'
                  ? (yFormatter ?? formatCompactCurrency)(value)
                  : String(value ?? '')
              }
            />
            <Legend content={<ChartLegend />} />
            {series.map((s, idx) => {
              const color = s.color ?? CHART_PALETTE[idx % CHART_PALETTE.length];
              return (
                <Area
                  key={s.dataKey}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.label}
                  stackId="stack"
                  stroke={color}
                  fill={color}
                  fillOpacity={0.35}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
