import type { BacktestResult } from '@/lib/backtest';
import { formatCompactCurrency } from '@/lib/format';

interface Props { result: BacktestResult; goalAmount: number; }

export function BelowGoalList({ result, goalAmount }: Props) {
  if (result.belowGoal.length === 0) return null;
  return (
    <div data-testid="backtest-below-goal" className="rounded-md border border-warning/40 bg-warning-soft p-4">
      <div className="text-sm font-semibold text-warning-foreground">
        Start years that ended below your {formatCompactCurrency(goalAmount)} goal
        {' · '}{result.belowGoal.length} of {result.startYears.count}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        {result.belowGoal.map((b) => {
          const depleted = b.tier === 'depleted';
          // SF-2: non-color cue — a glyph + an accessible label, not just a
          // colored dot (amber vs red is indistinguishable for red-confused
          // users). ✕ = ran out; ↓ = survived but under goal.
          const glyph = depleted ? '✕' : '↓';
          const label = depleted ? 'Depleted' : 'Below goal';
          return (
            <div
              key={b.startYear}
              className="flex items-center justify-between rounded border bg-background px-2 py-1 text-xs"
              title={depleted ? 'Depleted before the horizon' : 'Survived but finished below goal'}
            >
              <span className="font-medium">
                <span
                  aria-hidden
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full mr-1.5 text-[9px] font-bold text-white"
                  // Tokens shared with the chart (--destructive / --warning) so dots track theme.
                  style={{ background: depleted ? 'hsl(var(--destructive))' : 'hsl(var(--warning))' }}
                >
                  {glyph}
                </span>
                <span className="sr-only">{label}: </span>
                {b.startYear}
              </span>
              <span className="tabular-nums">{depleted ? '$0' : formatCompactCurrency(b.endingBalance)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
