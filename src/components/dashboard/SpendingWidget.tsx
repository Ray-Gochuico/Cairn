import { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PieChartIcon, BarChart3Icon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import BarChartCard from '@/components/charts/BarChartCard';
import { paletteColorAt, CHART_NEUTRAL } from '@/components/charts/palette';
import { CHART_TOOLTIP_PROPS } from '@/components/charts/ChartTooltip';
import { rangeBounds, summarizeSpendingForRange, type SpendingRange } from '@/lib/spending-widget';
import type { Account, Category, Transaction } from '@/types/schema';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS: Array<{ value: SpendingRange; label: string }> = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-30', label: 'Last 30 days' },
  { value: 'last-90', label: 'Last 90 days' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'last-12', label: 'Last 12 months' },
];

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
function formatUSD(n: number): string {
  return currencyFormatter.format(n);
}

/**
 * Mint-style spending widget for the Dashboard.
 *
 * Layout (top → bottom):
 *  1. Filter bar — merchant search, source-account select, time-range select,
 *     custom date-window inputs (only shown when range = 'custom' isn't used
 *     yet; user can override start/end manually for now), and a "Compare to"
 *     link stub (comparison computation is a follow-up; the link wires the
 *     affordance now).
 *  2. Chart row — donut (default) or horizontal bar, toggled via the
 *     corner button. Donut shows the category breakdown with a center label
 *     "Total spending $X,XXX"; bar shows the same data as horizontal bars.
 *     A right-side legend lists every category (color dot + name).
 *  3. "Your Spending" list — category + dollar total per row, sorted by
 *     amount descending.
 *  4. "Most purchases" callout — single row showing the category with the
 *     highest transaction count in the range.
 *
 * Data flow: the widget is presentational — it accepts transactions, accounts,
 * and categories from the Dashboard parent (which loads them from zustand)
 * rather than touching stores itself. This keeps the component
 * straightforward to test with synthetic data via React Testing Library.
 *
 * Misc categories appear normally here (unlike investment concentration
 * warnings, which suppress them). The widget shows what was actually spent,
 * Misc included.
 */
export interface SpendingWidgetProps {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  /** Anchor "today" for resolving ranges. Defaults to new Date(). Tests inject. */
  asOf?: Date;
}

function colorForCategory(
  index: number,
  override: string | null,
  isUncategorized: boolean,
): string {
  if (override) return override;
  if (isUncategorized) return CHART_NEUTRAL;
  return paletteColorAt(index);
}

export function SpendingWidget({
  transactions,
  categories,
  accounts,
  asOf,
}: SpendingWidgetProps) {
  const today = useMemo(() => asOf ?? new Date(), [asOf]);

  const [merchantQuery, setMerchantQuery] = useState('');
  const [accountId, setAccountId] = useState<string>('all');
  const [range, setRange] = useState<SpendingRange>('this-month');
  const [chartMode, setChartMode] = useState<'donut' | 'bar'>('donut');

  const bounds = useMemo(() => rangeBounds(range, today), [range, today]);

  const summary = useMemo(
    () =>
      summarizeSpendingForRange(transactions, categories, bounds, {
        accountId: accountId === 'all' ? null : Number(accountId),
        merchantQuery,
      }),
    [transactions, categories, bounds, accountId, merchantQuery],
  );

  // Decorate each category row with a chart color so the donut, the bar
  // chart, and the legend all use the same palette assignment.
  const rows = useMemo(
    () =>
      summary.byCategory.map((row, idx) => ({
        ...row,
        chartColor: colorForCategory(idx, row.color, row.categoryId === null),
      })),
    [summary.byCategory],
  );

  const donutSlices = rows.map((r) => ({
    name: r.name,
    value: r.total,
    color: r.chartColor,
  }));

  const barData = rows.map((r) => ({ category: r.name, amount: r.total }));
  const barSeries = [{ dataKey: 'amount', label: 'Spent' }];

  const hasData = rows.length > 0;
  const rangeLabel =
    RANGE_OPTIONS.find((opt) => opt.value === range)?.label ?? 'This month';

  return (
    <Card data-testid="spending-widget">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Spending</CardTitle>
          <div
            className="inline-flex rounded-md border bg-background p-0.5"
            role="group"
            aria-label="Chart view"
          >
            <button
              type="button"
              onClick={() => setChartMode('donut')}
              aria-pressed={chartMode === 'donut'}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors',
                chartMode === 'donut' && 'bg-muted text-foreground',
              )}
              data-testid="spending-widget-donut-toggle"
              aria-label="Show donut chart"
            >
              <PieChartIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setChartMode('bar')}
              aria-pressed={chartMode === 'bar'}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors',
                chartMode === 'bar' && 'bg-muted text-foreground',
              )}
              data-testid="spending-widget-bar-toggle"
              aria-label="Show bar chart"
            >
              <BarChart3Icon className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div
          className="grid grid-cols-1 md:grid-cols-4 gap-2"
          data-testid="spending-widget-filters"
        >
          <Input
            type="search"
            value={merchantQuery}
            onChange={(e) => setMerchantQuery(e.target.value)}
            placeholder="Search merchants"
            aria-label="Search transactions by merchant"
            data-testid="spending-widget-merchant-input"
          />
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger aria-label="Filter by account" data-testid="spending-widget-account-select">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts
                .filter((a) => a.id != null)
                .map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={(v) => setRange(v as SpendingRange)}>
            <SelectTrigger aria-label="Time range" data-testid="spending-widget-range-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div
            className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
            data-testid="spending-widget-date-bounds"
          >
            <span>{bounds.startInclusive}</span>
            <span>→</span>
            <span>{bounds.endInclusive}</span>
          </div>
        </div>
        <div className="text-xs">
          <button
            type="button"
            className="text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            disabled
            title="Comparison view coming soon"
            data-testid="spending-widget-compare"
          >
            Compare to…
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasData ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No spending found for {rangeLabel.toLowerCase()}.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px] gap-6 items-center">
              <div className="min-h-[260px]" data-testid="spending-widget-chart">
                {chartMode === 'donut' ? (
                  <div className="relative h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutSlices}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={70}
                          outerRadius={100}
                          paddingAngle={1}
                          isAnimationActive={false}
                        >
                          {donutSlices.map((slice, idx) => (
                            <Cell key={`${slice.name}-${idx}`} fill={slice.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          {...CHART_TOOLTIP_PROPS}
                          formatter={(value, name) => {
                            if (typeof value !== 'number') return [String(value), String(name)];
                            const pct = summary.total > 0
                              ? ` (${((value / summary.total) * 100).toFixed(1)}%)`
                              : '';
                            return [`${formatUSD(value)}${pct}`, String(name)];
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div
                      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
                      data-testid="spending-widget-center"
                    >
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                        Total spending
                      </div>
                      <div className="text-2xl font-semibold tabular-nums">
                        {formatUSD(summary.total)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <BarChartCard
                    title=""
                    data={barData}
                    xKey="category"
                    series={barSeries}
                    layout="vertical"
                    height={260}
                    yFormatter={formatUSD}
                  />
                )}
              </div>
              <ul
                className="space-y-1.5 text-sm"
                data-testid="spending-widget-legend"
              >
                {rows.map((r) => (
                  <li
                    key={r.categoryId ?? 'uncategorized'}
                    className="flex items-center gap-2"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: r.chartColor }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{r.name}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div data-testid="spending-widget-list">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Your Spending
              </div>
              <ul className="divide-y rounded-md border">
                {rows.map((r) => (
                  <li
                    key={r.categoryId ?? 'uncategorized'}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: r.chartColor }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{r.name}</span>
                    </div>
                    <span className="tabular-nums">{formatUSD(r.total)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {summary.topByCount ? (
              <div
                className="rounded-md bg-muted/50 px-3 py-2 text-sm"
                data-testid="spending-widget-most-purchases"
              >
                <span className="font-medium">Most purchases</span>:{' '}
                <span>{summary.topByCount.count}</span>{' '}
                <span className="text-muted-foreground">in</span>{' '}
                <span>{summary.topByCount.name}</span>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
