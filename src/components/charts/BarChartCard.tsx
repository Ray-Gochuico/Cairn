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
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
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
                  width={96}
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
                fill={s.color ?? CHART_PALETTE[idx % CHART_PALETTE.length]}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
