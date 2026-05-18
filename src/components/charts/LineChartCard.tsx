import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

export interface LineChartPoint {
  [key: string]: number | string;
}

export interface LineChartSeries {
  dataKey: string;
  label: string;
  color?: string;
}

export interface LineChartCardProps {
  title: string;
  subtitle?: string;
  height?: number;
  data: LineChartPoint[];
  xKey: string;
  series: LineChartSeries[];
  yFormatter?: (value: number) => string;
}

export default function LineChartCard({
  title,
  subtitle,
  height = 240,
  data,
  xKey,
  series,
  yFormatter,
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey={xKey} stroke="#64748b" fontSize={12} />
            <YAxis
              stroke="#64748b"
              fontSize={12}
              tickFormatter={yFormatter}
              width={yFormatter ? 64 : 48}
            />
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
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.label}
                stroke={s.color ?? CHART_PALETTE[idx % CHART_PALETTE.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
