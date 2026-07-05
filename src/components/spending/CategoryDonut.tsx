import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { paletteColorAt, CHART_NEUTRAL } from '@/components/charts/palette';
import { CHART_TOOLTIP_PROPS } from '@/components/charts/ChartTooltip';
import { formatCurrency } from '@/lib/format';

/**
 * Category spending donut + center-total overlay, extracted from
 * SpendingWidget so the Spending page hero can reuse the exact chart
 * instead of forking it. Deliberately narrow: the filter bar, legend list,
 * and "Most purchases" callout stay widget-private (the hero frames those
 * differently). The color decoration (withCategoryColors) travels with it
 * because both consumers must assign identical palette slots.
 */

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

/**
 * Tooltip formatter factory, hoisted so the per-render identity only changes
 * when `total` does (recharts 3.x re-render discipline — fresh function
 * props re-trigger recharts' internal layout dispatch; see the hoisted-props
 * note in AssetValueChart.tsx).
 */
function makeTooltipFormatter(total: number) {
  return (value: unknown, name: unknown): [string, string] => {
    if (typeof value !== 'number') return [String(value), String(name)];
    const pct = total > 0 ? ` (${((value / total) * 100).toFixed(1)}%)` : '';
    return [`${formatCurrency(value)}${pct}`, String(name)];
  };
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
  const tooltipFormatter = useMemo(() => makeTooltipFormatter(total), [total]);
  const pctOf = (value: number) =>
    total > 0 ? `${((value / total) * 100).toFixed(1)}%` : null;
  // role="img" one-sentence summary (round-2 B2; pattern: DonutChartCard's
  // ariaSummary): top 3 slices by value + a remainder count, so SRs get one
  // sentence instead of a silent canvas. The sr-only <ul> below is the
  // granular non-visual path — deliberately NOT a visible legend, because
  // the sole consumer (SpendingWidget) already renders a visible legend and
  // a per-category value list around this donut.
  const topForAria = [...slices].sort((a, b) => b.value - a.value).slice(0, 3);
  const ariaSummary =
    slices.length === 0
      ? 'Spending by category'
      : 'Spending by category: ' +
        topForAria.map((s) => `${s.name} ${pctOf(s.value) ?? ''}`.trim()).join(', ') +
        (slices.length > 3 ? `, +${slices.length - 3} more` : '');
  return (
    <div className="relative" style={{ height }}>
      <div role="img" aria-label={ariaSummary} className="h-full w-full">
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
            <Tooltip {...CHART_TOOLTIP_PROPS} formatter={tooltipFormatter} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {slices.length > 0 && (
        <ul className="sr-only" aria-label="Spending by category">
          {slices.map((slice, idx) => (
            <li key={`${slice.name}-${idx}`}>
              {slice.name} — {formatCurrency(slice.value)}
              {pctOf(slice.value) ? ` (${pctOf(slice.value)})` : ''}
            </li>
          ))}
        </ul>
      )}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        data-testid={centerTestId}
      >
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Total spending
        </div>
        <div className="text-2xl font-semibold tabular-nums">
          {formatCurrency(total)}
        </div>
      </div>
    </div>
  );
}
