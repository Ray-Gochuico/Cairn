import type { ReactNode } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CHART_PALETTE } from './palette';

export interface DonutSlice {
  name: string;
  value: number;
  color?: string;
}

export interface DonutChartCardProps {
  title: string;
  /**
   * Subtitle text or any ReactNode (e.g. a "Back" button for drill-down
   * donuts). Renders inside CardDescription.
   */
  subtitle?: ReactNode;
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
  /**
   * Optional. Formats the slice name shown in the tooltip. The legend
   * keeps showing the raw slice name unchanged. Use this to show longer
   * labels (e.g., "AAPL — Apple Inc.") on hover without bloating the legend.
   */
  tooltipNameFormatter?: (name: string) => string;
  /**
   * Optional. Invoked with the clicked slice's `name` when a wedge is
   * clicked. Setting this also flips the donut to a pointer cursor so
   * the affordance is visible. Used by SectorDonut to drill into a
   * sector's industry breakdown.
   */
  onClickSlice?: (sliceName: string) => void;
}

export default function DonutChartCard({
  title,
  subtitle,
  height = 240,
  data,
  innerRadius = 60,
  outerRadius = 90,
  labelFormatter,
  valueFormatter,
  tooltipNameFormatter,
  onClickSlice,
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
              onClick={
                onClickSlice
                  ? (entry: unknown) => {
                      const name = (entry as { name?: unknown } | undefined)?.name;
                      if (typeof name === 'string') onClickSlice(name);
                    }
                  : undefined
              }
              style={onClickSlice ? { cursor: 'pointer' } : undefined}
            >
              {data.map((slice, idx) => (
                <Cell
                  key={`${slice.name}-${idx}`}
                  fill={slice.color ?? CHART_PALETTE[idx % CHART_PALETTE.length]}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => {
                const displayName = tooltipNameFormatter && typeof name === 'string'
                  ? tooltipNameFormatter(name)
                  : String(name ?? '');
                if (typeof value !== 'number') {
                  return [String(value ?? ''), displayName];
                }
                const pct = total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : '';
                const formatted = valueFormatter ? `${valueFormatter(value)}${pct}` : `${value}${pct}`;
                return [formatted, displayName];
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
