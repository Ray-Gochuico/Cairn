import { CalculatorCard } from './CalculatorCard';
import { InlineLink } from '@/components/calculators/InlineLink';
import { readLastBacktestRun } from '@/lib/backtest/last-run';
import { formatDate } from '@/lib/format';

interface BacktestCardProps {
  cardId?: string;
}

/**
 * Wave 18 C9 — verdict waymark. The card carries the LAST run's verdict
 * ("N% of M" start years met the goal) from the D3 localStorage cache; with
 * no (or an unreadable) record it keeps the honest imperative and makes no
 * data claims. "Last run {date}" in the meaning is the staleness disclosure —
 * the record is a cache of a recomputable result, never authority.
 */
export function BacktestCard({ cardId }: BacktestCardProps = {}) {
  const lastRun = readLastBacktestRun();
  const pct =
    lastRun && lastRun.startYearsCount > 0
      ? Math.round((lastRun.goalMetCount / lastRun.startYearsCount) * 100)
      : null;
  return (
    <CalculatorCard
      title="Historical Backtest"
      titleText="Historical Backtest"
      cardId={cardId}
      headline={
        lastRun && pct != null ? (
          <span data-testid="backtest-verdict">
            {pct}% of {lastRun.startYearsCount}
          </span>
        ) : (
          'Backtest your portfolio'
        )
      }
      meaning={
        lastRun
          ? `start years since 1871 sustained this plan · last run ${formatDate(lastRun.runAt.slice(0, 10))}`
          : undefined
      }
    >
      <p className="text-sm text-muted-foreground">
        Replay historical market sequences against your current portfolio
        allocation to see how past conditions would have affected your outcomes.
      </p>
      <div className="mt-2">
        <InlineLink
          to="/calculators/backtest"
          aria-label="Open the Historical Backtest tool"
          className="text-sm"
        >
          Open the Backtest tool →
        </InlineLink>
      </div>
    </CalculatorCard>
  );
}
