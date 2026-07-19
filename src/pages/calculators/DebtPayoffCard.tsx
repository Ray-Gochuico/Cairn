import { useMemo } from 'react';
import { useLoansStore } from '@/stores/loans-store';
import { useLocalToday } from '@/lib/use-local-today';
import { scheduleIsCapped } from '@/lib/amortization';
import { CalculatorCard, EmptyMeaning, RailReset } from './CalculatorCard';
import { formatCurrency, formatMonth } from '@/lib/format';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { StatTile } from '@/components/calculators/StatTile';
import { CalcTable, CalcRow, type CalcColumn } from '@/components/calculators/CalcTable';
import { InlineChart } from '@/components/charts/InlineChart';
import {
  pickStrategyTargetIndex,
  projectionsFor,
  type Strategy,
  type LoanProjection,
} from '@/lib/debt-payoff';
import {
  compareStrategies,
  type StrategyOutcome,
} from '@/lib/debt-payoff-comparison';
import { InlineLink } from '@/components/calculators/InlineLink';
import { cn } from '@/lib/utils';

/**
 * Format an ISO YYYY-MM-DD payoff date as a friendly "Mon YYYY" string
 * (amortization is monthly so day precision is irrelevant).
 * Returns '—' for null/empty input.
 */
function formatPayoffDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  // Parse as UTC midnight to avoid local-timezone day shifts.
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' });
}

// Re-export the lib types/functions so existing tests importing from this
// module continue to compile.
export type { Strategy, LoanProjection };
export { pickStrategyTargetIndex, projectionsFor };

const TABLE_COLUMNS: CalcColumn[] = [
  { key: 'loan', header: 'Loan' },
  { key: 'payoff', header: 'Payoff', numeric: true },
  { key: 'interest', header: 'Interest', numeric: true },
];

interface DebtPayoffCardProps {
  cardId?: string;
}

/** One strategy column (D11): payoff / interest / saved, each suppressed to
 *  '—' under its capped flag exactly as the old tiles were. No winner badge,
 *  no color-coding — the quiet border marks "your pick" only. */
function StrategyColumn({
  heading,
  outcome,
  highlighted,
  testKey,
}: {
  heading: string;
  outcome: StrategyOutcome;
  highlighted: boolean;
  testKey: string;
}) {
  return (
    <div
      data-testid={`debt-column-${testKey}`}
      className={cn('rounded-md border p-3 space-y-2', highlighted && 'border-primary/40')}
    >
      <div className="text-sm font-medium">{heading}</div>
      <div className="space-y-2 text-sm">
        <div>
          <div className="text-muted-foreground">Payoff</div>
          <div className="tabular-nums font-medium" data-testid={`debt-${testKey}-payoff`}>
            {outcome.anyCapped ? '—' : formatPayoffDate(outcome.payoffDate)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Total interest</div>
          <div className="tabular-nums font-medium" data-testid={`debt-${testKey}-interest`}>
            {outcome.anyCapped ? '—' : formatCurrency(outcome.totalInterest)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Saved vs minimums</div>
          <div className="tabular-nums font-medium" data-testid={`debt-${testKey}-saved`}>
            {outcome.savingsCapped ? '—' : formatCurrency(outcome.savedVsMinimums)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DebtPayoffCard({ cardId }: DebtPayoffCardProps = {}) {
  const loans = useLoansStore((s) => s.loans);

  const defaults = useMemo(() => ({ strategy: 'none' as Strategy, extraTotal: 0 }), []);
  const { values, setValue, reset, isOverridden, overriddenKeys } = useCalculatorState(
    cardId ?? 'debt-payoff',
    defaults,
  );

  // Live LOCAL day (Wave 11 T10): anchors every remaining schedule.
  const todayIso = useLocalToday();

  // D11: BOTH strategies are always computed at the shared extra; the select
  // below only highlights a column. compareStrategies also carries the
  // all-minimums baseline (moved verbatim from this card's old useMemo).
  const comparison = useMemo(
    () => compareStrategies(loans, values.extraTotal ?? 0, todayIso),
    [loans, values.extraTotal, todayIso],
  );

  // The table + chart follow the HIGHLIGHTED strategy (avalanche when 'none'
  // — the caption below names it so the table is never ambiguous).
  const highlighted = values.strategy ?? 'none';
  const displayed =
    highlighted === 'snowball' ? comparison.snowball : comparison.avalanche;

  // Downslope rows: total remaining balance by month under the displayed
  // plan — months past a shorter schedule's end implicitly contribute 0.
  const downslope = useMemo(() => {
    if (displayed.anyCapped) return [];
    const byMonth = new Map<string, number>();
    for (const p of displayed.projections) {
      for (const row of p.amortization.schedule) {
        const m = row.paymentDate.slice(0, 7);
        byMonth.set(m, (byMonth.get(m) ?? 0) + row.balance);
      }
    }
    return [...byMonth.keys()]
      .sort()
      .slice(0, 360)
      .map((m) => ({ label: formatMonth(m), balance: byMonth.get(m) ?? 0 }));
  }, [displayed]);

  if (loans.length === 0) {
    return (
      <CalculatorCard
        cardId={cardId}
        title="Debt Payoff"
        headline="—"
        meaning={
          // Wave 15 T10: the CTA itself is the link. W14b: it deep-links the
          // loan's post-Inputs home (/loans, "one place per thing").
          <EmptyMeaning>
            <InlineLink to="/loans">
              Add loans
            </InlineLink>{' '}
            on the Loans page to see payoff projections.
          </EmptyMeaning>
        }
      />
    );
  }

  const totalBalance = loans.reduce((a, l) => a + l.currentBalance, 0);
  const anyCapped = displayed.anyCapped;
  const cappedProjections = displayed.projections.filter((p) =>
    scheduleIsCapped(p.amortization.schedule),
  );
  const savingsCapped = displayed.savingsCapped;

  // Wave 17 meaning contract: a capped schedule REPLACES the sentence with
  // the warning (the rescued-baseline-only case keeps the normal sentence —
  // the body banner covers it).
  const meaning = anyCapped ? (
    <span className="text-warning-foreground">
      {cappedProjections.map((p) => p.loan.name).join(', ')} never{' '}
      {cappedProjections.length === 1 ? 'pays' : 'pay'} off at the current payment.
    </span>
  ) : (
    <>
      {formatCurrency(totalBalance)} across{' '}
      {loans.length === 1 ? '1 loan' : `${loans.length} loans`}.
    </>
  );

  const extra = values.extraTotal ?? 0;
  const tradeoffVisible =
    !comparison.identical &&
    !comparison.avalanche.anyCapped &&
    !comparison.snowball.anyCapped &&
    comparison.monthsDelta != null;
  const tie =
    tradeoffVisible &&
    Math.abs(comparison.interestDelta) < 0.5 &&
    Math.abs(comparison.monthsDelta ?? 0) === 0;

  return (
    <CalculatorCard
      cardId={cardId}
      title="Debt Payoff"
      dirty={isOverridden}
      meaning={meaning}
      rail={
        <>
          {isOverridden && <RailReset onClick={reset} />}
          <div className="space-y-1">
            <Label htmlFor="debt-strategy">Highlight a strategy</Label>
            <Select
              value={values.strategy}
              onValueChange={(v) => setValue('strategy', v as Strategy)}
            >
              <SelectTrigger id="debt-strategy" aria-label="Highlight a strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="snowball">Snowball (smallest balance)</SelectItem>
                <SelectItem value="avalanche">Avalanche (highest rate)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Both plans are always computed — pick one to highlight.
            </p>
          </div>
          <NumberField
            id="debt-extra"
            label="Extra monthly payment"
            value={values.extraTotal}
            onChange={(v) => setValue('extraTotal', v != null && v >= 0 ? v : 0)}
            step="50"
            min={0}
            edited={overriddenKeys.has('extraTotal')}
          />
        </>
      }
      headline={
        <span data-testid="debt-payoff-headline">
          {/* Wave 15 T7 (D7): the headline is the ANSWER. A capped schedule
              must never claim a date — same poisoning rule as the columns. */}
          {anyCapped || !displayed.payoffDate
            ? '—'
            : `Debt-free ${formatPayoffDate(displayed.payoffDate)}`}
        </span>
      }
    >
      {savingsCapped && (
        <div
          role="note"
          data-testid="debt-never-payoff-notice"
          className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
        >
          {anyCapped ? (
            <>
              <span className="font-medium">
                {cappedProjections.map((p) => p.loan.name).join(', ')}
              </span>{' '}
              never {cappedProjections.length === 1 ? 'pays' : 'pay'} off at the current payment.
              Payoff and interest figures are hidden; fix the payment or rate on the Loans page.
            </>
          ) : (
            // Rescued case (F1): the projection amortizes thanks to extra
            // payments, but the extra-less baseline never does — only the
            // savings comparison is meaningless, so only it hides.
            <>
              Without extra payments{' '}
              <span className="font-medium">{comparison.baselineCappedNames.join(', ')}</span>{' '}
              never {comparison.baselineCappedNames.length === 1 ? 'pays' : 'pay'} off, so the savings
              comparison is hidden.
            </>
          )}
        </div>
      )}
      {/* The balance is always real — never suppressed (Wave 15 T7). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <StatTile
          label="Total balance"
          value={formatCurrency(totalBalance)}
          testId="debt-total-balance"
        />
      </div>

      {/* D11: strategy columns — both always computed, the pick only draws a
          quiet highlight. A single loan (identical plans) renders ONE column. */}
      {comparison.identical ? (
        <div className="grid grid-cols-1 gap-3 sm:max-w-xs">
          <StrategyColumn
            heading="Extra payment plan"
            outcome={comparison.avalanche}
            highlighted={highlighted !== 'none'}
            testKey="avalanche"
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StrategyColumn
            heading="Avalanche — highest rate first"
            outcome={comparison.avalanche}
            highlighted={highlighted === 'avalanche'}
            testKey="avalanche"
          />
          <StrategyColumn
            heading="Snowball — smallest balance first"
            outcome={comparison.snowball}
            highlighted={highlighted === 'snowball'}
            testKey="snowball"
          />
        </div>
      )}

      {tradeoffVisible && (
        <p className="text-sm text-muted-foreground" data-testid="debt-tradeoff-row">
          {tie ? (
            <>At this extra amount the two strategies tie for you.</>
          ) : (
            <>
              At {formatCurrency(extra)}/mo extra, the difference for you is{' '}
              {formatCurrency(Math.abs(comparison.interestDelta))} and{' '}
              {Math.abs(comparison.monthsDelta ?? 0)} months — avalanche minimizes interest;
              snowball clears your smallest balance first.
            </>
          )}
        </p>
      )}

      {/* Trimmed per-loan CalcTable (Loan | Payoff | Interest), rows from the
          highlighted strategy's projections. */}
      {highlighted === 'none' && !comparison.identical && (
        <p className="text-xs text-muted-foreground">showing the avalanche plan</p>
      )}
      <CalcTable columns={TABLE_COLUMNS} testId="debt-loan-table">
        {displayed.projections.map((p) => {
          const last = p.amortization.schedule[p.amortization.schedule.length - 1];
          const capped = scheduleIsCapped(p.amortization.schedule);
          return (
            <CalcRow
              key={p.loan.id ?? p.loan.name}
              columns={TABLE_COLUMNS}
              testId={`debt-loan-row-${p.loan.id ?? p.loan.name}`}
              cells={[
                p.loan.name,
                <span data-testid={`debt-loan-payoff-${p.loan.id ?? p.loan.name}`}>
                  {capped ? (
                    <span className="text-warning-foreground">Never at this payment</span>
                  ) : (
                    formatPayoffDate(last?.paymentDate)
                  )}
                </span>,
                capped ? '—' : formatCurrency(p.amortization.totalInterest),
              ]}
            />
          );
        })}
      </CalcTable>

      {/* The downslope (C10): total remaining balance under the shown plan.
          Suppressed entirely when capped — a capped schedule's tail is a lie. */}
      {!anyCapped && downslope.length > 1 && (
        <InlineChart
          label="The downslope"
          testId="debt-downslope-chart"
          data={downslope}
          xKey="label"
          series={[{ dataKey: 'balance', label: 'Remaining balance', hero: true }]}
          yFormatter={formatCurrency}
        />
      )}
    </CalculatorCard>
  );
}
