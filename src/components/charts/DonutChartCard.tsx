import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface DonutSlice {
  name: string;
  value: number;
  color?: string;
}

export interface DonutChartCardProps {
  title: string;
  subtitle?: string;
  height?: number;
  data: DonutSlice[];
  innerRadius?: number;
  outerRadius?: number;
  labelFormatter?: (slice: DonutSlice) => string;
  /**
   * Formats raw slice values for the tooltip. Use for $ or % displays.
   * If omitted, Recharts shows the raw number.
   */
  valueFormatter?: (value: number) => string;
}

const DEFAULT_PALETTE = [
  '#0f172a',
  '#1e293b',
  '#475569',
  '#64748b',
  '#94a3b8',
  '#cbd5e1',
  '#e2e8f0',
];

export default function DonutChartCard({
  title,
  subtitle,
  height = 240,
  data,
  innerRadius = 60,
  outerRadius = 90,
  labelFormatter,
  valueFormatter,
}: DonutChartCardProps) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={1}
              label={
                labelFormatter
                  ? (entry) => labelFormatter(entry as DonutSlice)
                  : undefined
              }
            >
              {data.map((slice, idx) => (
                <Cell
                  key={`${slice.name}-${idx}`}
                  fill={slice.color ?? DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={
                valueFormatter
                  ? (value, name) => {
                      if (typeof value !== 'number') {
                        return [String(value ?? ''), String(name ?? '')];
                      }
                      const pct = total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : '';
                      return [`${valueFormatter(value)}${pct}`, String(name ?? '')];
                    }
                  : undefined
              }
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
