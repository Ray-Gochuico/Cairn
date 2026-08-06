import { useLocation } from 'react-router-dom';
import { CalculatorCard, EmptyMeaning } from './CalculatorCard';
import { InlineLink } from '@/components/calculators/InlineLink';
import { readLastBacktestRun } from '@/lib/backtest/last-run';
import { formatDate } from '@/lib/format';
import { usePersonsStore } from '@/stores/persons-store';
import { withViewSearch } from '@/lib/view-scope';

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
  // Wave B (CB23/D-B14): 2-person households see which scope produced the
  // verdict; legacy records (no field) were all household runs by construction.
  const persons = usePersonsStore((s) => s.persons);
  const location = useLocation();
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
        lastRun ? (
          `start years since 1871 sustained this plan · last run ${formatDate(lastRun.runAt.slice(0, 10))}${
            persons.length === 2 ? ` · ${lastRun.scopeLabel ?? 'Household'} run` : ''
          }`
        ) : (
          // Wave C (N3, CW20): pre-first-run the meaning slot was empty — an
          // honest invite, no run, no verdict, no data claim (the W18 C9
          // honest-imperative intent survives).
          <EmptyMeaning>Replay 150+ years of markets against your allocation.</EmptyMeaning>
        )
      }
    >
      <p className="text-sm text-muted-foreground">
        Replay historical market sequences against your current portfolio
        allocation to see how past conditions would have affected your outcomes.
      </p>
      <div className="mt-2">
        <InlineLink
          to={withViewSearch('/calculators/backtest', location.search)}
          aria-label="Open the Historical Backtest tool"
          className="text-sm"
        >
          Open the Backtest tool →
        </InlineLink>
      </div>
    </CalculatorCard>
  );
}
