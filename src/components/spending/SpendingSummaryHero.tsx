import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CategoryDonut, withCategoryColors } from '@/components/spending/CategoryDonut';
import {
  RANGE_OPTIONS,
  rangeBounds,
  summarizeSpendingForRange,
  type SpendingRange,
} from '@/lib/spending-widget';
import type { Category, Transaction } from '@/types/schema';

/**
 * Spending glance hero — the page-top summary that answers "how much did I
 * spend" before the importer/chore sections. Built ENTIRELY from existing
 * analytics (rangeBounds + summarizeSpendingForRange + the household
 * budget + the shared CategoryDonut); it REPLACES the old "Current month
 * vs budget + MoM" grid (same numbers, new home).
 *
 * The MoM delta and budget bar render ONLY for the 'this-month' range —
 * comparing a 90-day window to "last month's full total" is nonsense
 * (calendar honesty over symmetry).
 */
export interface SpendingSummaryHeroProps {
  transactions: Transaction[];
  categories: Category[];
  /** household.monthlyExpenseBaseline ?? 0 — 0 hides the budget bar. */
  monthlyBudget: number;
  /** Injectable clock for tests. */
  asOf?: Date;
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
function formatUSD(n: number): string {
  return currencyFormatter.format(n);
}

const NO_FILTERS = { accountId: null, merchantQuery: '' } as const;

export function SpendingSummaryHero({
  transactions,
  categories,
  monthlyBudget,
  asOf,
}: SpendingSummaryHeroProps) {
  const today = useMemo(() => asOf ?? new Date(), [asOf]);
  const [range, setRange] = useState<SpendingRange>('this-month');

  const bounds = useMemo(() => rangeBounds(range, today), [range, today]);
  const summary = useMemo(
    () => summarizeSpendingForRange(transactions, categories, bounds, NO_FILTERS),
    [transactions, categories, bounds],
  );
  const lastMonthTotal = useMemo(
    () =>
      summarizeSpendingForRange(
        transactions,
        categories,
        rangeBounds('last-month', today),
        NO_FILTERS,
      ).total,
    [transactions, categories, today],
  );

  const rows = useMemo(() => withCategoryColors(summary.byCategory), [summary.byCategory]);
  const donutSlices = useMemo(
    () => rows.map((r) => ({ name: r.name, value: r.total, color: r.chartColor })),
    [rows],
  );

  const rangeLabel = RANGE_OPTIONS.find((opt) => opt.value === range)?.label ?? 'This month';
  const isThisMonth = range === 'this-month';
  const momDelta = summary.total - lastMonthTotal;
  const budgetPct = monthlyBudget > 0 ? Math.min(summary.total / monthlyBudget, 1) : 0;
  const overBudget = monthlyBudget > 0 && summary.total > monthlyBudget;

  return (
    <Card data-testid="spending-hero">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Spending</CardTitle>
          {/* Same Radix tabs range grammar as AssetValueChart/GrowthCard;
              the vocabulary is the shared RANGE_OPTIONS (calendar ranges). */}
          <Tabs value={range} onValueChange={(v) => setRange(v as SpendingRange)}>
            <TabsList aria-label="Time range" className="h-auto flex-wrap">
              {RANGE_OPTIONS.map((opt) => (
                <TabsTrigger key={opt.value} value={opt.value}>
                  {opt.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        {summary.byCategory.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No spending found for {rangeLabel.toLowerCase()}.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px] gap-6 items-center">
            <div className="space-y-2">
              <div
                className="text-3xl font-semibold tabular-nums"
                data-testid="spending-hero-total"
              >
                {formatUSD(summary.total)}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <span>{bounds.startInclusive}</span>
                <span>→</span>
                <span>{bounds.endInclusive}</span>
              </div>
              {isThisMonth && (
                <p
                  className={`text-sm ${
                    lastMonthTotal <= 0 || momDelta === 0
                      ? 'text-muted-foreground'
                      : momDelta > 0
                        ? 'text-destructive'
                        : 'text-success'
                  }`}
                >
                  {lastMonthTotal <= 0
                    ? 'No prior-month data'
                    : momDelta === 0
                      ? // Exactly-even months are neutral, not a green "+$0"
                        // (parity with the old summary grid's copy).
                        'Same as last month so far'
                      : `${momDelta > 0 ? '+' : '−'}${formatUSD(Math.abs(momDelta))} vs last month's full total (month in progress)`}
                </p>
              )}
              {isThisMonth && monthlyBudget > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${overBudget ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${budgetPct * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {overBudget
                      ? `$${(summary.total - monthlyBudget).toFixed(2)} over budget`
                      : `$${(monthlyBudget - summary.total).toFixed(2)} under budget`}{' '}
                    (budget: ${monthlyBudget.toLocaleString()})
                  </p>
                </div>
              )}
            </div>
            <CategoryDonut
              slices={donutSlices}
              total={summary.total}
              height={220}
              centerTestId="spending-hero-center"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
