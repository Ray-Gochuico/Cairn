import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { paletteColorAt, CHART_NEUTRAL } from '@/components/charts/palette';
import { CHART_TOOLTIP_PROPS } from '@/components/charts/ChartTooltip';

/**
 * Category spending donut + center-total overlay, extracted from
 * SpendingWidget so the Spending page hero can reuse the exact chart
 * instead of forking it. Deliberately narrow: the filter bar, legend list,
 * and "Most purchases" callout stay widget-private (the hero frames those
 * differently). The color decoration (withCategoryColors) travels with it
 * because both consumers must assign identical palette slots.
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
function formatUSD(n: number): string {
  return currencyFormatter.format(n);
}

export interface CategoryDonutSlice {
  name: string;
  value: number;
  color: string;
}

/** Decorate summarize-rows with resolved chart colors (override → neutral-for-uncategorized → palette by index). */
export function withCategoryColors<R extends { categoryId: number | null; color: string | null }>(
  rows: R[],
): Array<R & { chartColor: string }> {
  return rows.map((row, idx) => ({
    ...row,
    chartColor: row.color ?? (row.categoryId === null ? CHART_NEUTRAL : paletteColorAt(idx)),
  }));
}

export function CategoryDonut({
  slices,
  total,
  height = 260,
  centerTestId,
}: {
  slices: CategoryDonutSlice[];
  total: number;
  height?: number;
  centerTestId?: string;
}) {
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={100}
            paddingAngle={1}
            isAnimationActive={false}
          >
            {slices.map((slice, idx) => (
              <Cell key={`${slice.name}-${idx}`} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip
            {...CHART_TOOLTIP_PROPS}
            formatter={(value, name) => {
              if (typeof value !== 'number') return [String(value), String(name)];
              const pct = total > 0
                ? ` (${((value / total) * 100).toFixed(1)}%)`
                : '';
              return [`${formatUSD(value)}${pct}`, String(name)];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        data-testid={centerTestId}
      >
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Total spending
        </div>
        <div className="text-2xl font-semibold tabular-nums">
          {formatUSD(total)}
        </div>
      </div>
    </div>
  );
}
