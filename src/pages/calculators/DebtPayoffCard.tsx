import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLoansStore } from '@/stores/loans-store';
import { useLocalToday } from '@/lib/use-local-today';
import { amortize, nextPaymentDateFrom, scheduleIsCapped } from '@/lib/amortization';
import { CalculatorCard } from './CalculatorCard';
import { formatCurrency } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useCalculatorState } from '@/lib/calculator-state';
import { StatTile } from '@/components/calculators/StatTile';
import {
  pickStrategyTargetIndex,
  projectionsFor,
  type Strategy,
  type LoanProjection,
} from '@/lib/debt-payoff';

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

interface DebtPayoffCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

export function DebtPayoffCard({ cardId, onHide }: DebtPayoffCardProps = {}) {
  const loans = useLoansStore((s) => s.loans);

  const defaults = useMemo(() => ({ strategy: 'none' as Strategy, extraTotal: 0 }), []);
  const { values, setValue, reset, isOverridden } = useCalculatorState(
    cardId ?? 'debt-payoff',
    defaults,
  );

  // Live LOCAL day (Wave 11 T10): anchors every remaining schedule.
  const todayIso = useLocalToday();

  const projections = useMemo(
    () => projectionsFor(loans, values.strategy, values.extraTotal, todayIso),
    [loans, values.strategy, values.extraTotal, todayIso],
  );

  // Baseline: every loan with extraPayment=0. Used to estimate "savings" from
  // the user's combined defaults + strategy choice. Recomputed only when the
  // loan set changes. Also reports WHICH loans' baselines are capped (review
  // F1): a below-interest contract payment that an extra RESCUES still has a
  // never-amortizing extra-less baseline, so "savings vs no-extra" would
  // difference a real projection against the cap's accumulation — the same
  // rule as Loans.tsx's savingsCapped (both sides must be honest).
  const baseline = useMemo(() => {
    let interest = 0;
    const cappedNames: string[] = [];
    for (const loan of loans) {
      const a = amortize({
        principal: loan.currentBalance,
        annualRatePct: loan.interestRate,
        termMonths: loan.termMonths,
        firstPaymentDate: nextPaymentDateFrom(loan.firstPaymentDate, todayIso),
        monthlyPayment: loan.monthlyPayment,
        extraPayment: 0,
      });
      interest += a.totalInterest;
      if (scheduleIsCapped(a.schedule)) cappedNames.push(loan.name);
    }
    return { interest, cappedNames };
  }, [loans, todayIso]);

  if (loans.length === 0) {
    return (
      <CalculatorCard
        cardId={cardId}
        onHide={onHide}
        title="Debt Payoff"
        headline="—"
      >
        <p className="text-sm text-muted-foreground">
          {/* Wave 15 T10: the CTA itself is the link. W14b: it deep-links the
              loan's post-Inputs home (/loans, "one place per thing"). */}
          <Link to="/loans" className="text-primary hover:underline">
            Add loans
          </Link>{' '}
          on the Loans page to see payoff projections.
        </p>
      </CalculatorCard>
    );
  }

  const totalBalance = loans.reduce((a, l) => a + l.currentBalance, 0);
  const totalInterest = projections.reduce(
    (a, p) => a + p.amortization.totalInterest,
    0,
  );
  const interestSavings = Math.max(0, baseline.interest - totalInterest);

  // Round-2 A1: a never-amortizing contract payment runs amortize() to its
  // safety cap — the "payoff date" is the cap month and "total interest" is
  // the cap's accumulation (~$9.2M on the probe), both lies. Any capped loan
  // poisons every aggregate (payoff = max over schedules; interest + savings
  // are sums over them), so the whole strip suppresses, not just one tile.
  const cappedProjections = projections.filter((p) => scheduleIsCapped(p.amortization.schedule));
  const anyCapped = cappedProjections.length > 0;
  // Review F1: the savings tile differences against the EXTRA-LESS baseline,
  // so it is poisoned when EITHER side is capped — including the rescued
  // case (projection amortizes, baseline doesn't).
  const savingsCapped = anyCapped || baseline.cappedNames.length > 0;

  // Estimated full-debt payoff: latest payment date across all schedules.
  // ISO YYYY-MM-DD strings sort lexicographically as dates do.
  const lastPaymentDates = projections
    .map((p) => p.amortization.schedule[p.amortization.schedule.length - 1]?.paymentDate)
    .filter((d): d is string => Boolean(d));
  const aggregatePayoffDate =
    lastPaymentDates.length > 0
      ? lastPaymentDates.reduce((latest, d) => (d > latest ? d : latest))
      : null;

  return (
    <CalculatorCard
      cardId={cardId}
      onHide={onHide}
      title="Debt Payoff"
      headline={
        <span data-testid="debt-payoff-headline">
          {/* Wave 15 T7 (D7): the headline is the ANSWER. A capped schedule
              must never claim a date — same poisoning rule as the tiles.
              (The null-date guard covers the degenerate empty-schedule case;
              loans.length === 0 already early-returned above.) */}
          {anyCapped || !aggregatePayoffDate
            ? '—'
            : `Debt-free ${formatPayoffDate(aggregatePayoffDate)}`}
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
              <span className="font-medium">{baseline.cappedNames.join(', ')}</span>{' '}
              never {baseline.cappedNames.length === 1 ? 'pays' : 'pay'} off, so the savings
              comparison is hidden.
            </>
          )}
        </div>
      )}
      {/* Aggregate metric strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        {/* T7 (D7): the balance — the demoted former headline — leads the
            strip. It is NEVER suppressed: the balance is always real, even
            when a capped schedule poisons the payoff-derived aggregates. */}
        <StatTile
          label="Total balance"
          value={formatCurrency(totalBalance)}
          testId="debt-total-balance"
        />
        <StatTile
          label="Total interest"
          value={anyCapped ? '—' : formatCurrency(totalInterest)}
          testId="debt-total-interest"
        />
        <StatTile
          label="Savings vs no-extra"
          value={savingsCapped ? '—' : formatCurrency(interestSavings)}
          testId="debt-savings"
        />
      </div>

      {/* Strategy + extra-payment controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div className="space-y-1">
          <Label htmlFor="debt-strategy">Strategy</Label>
          <Select
            value={values.strategy}
            onValueChange={(v) => setValue('strategy', v as Strategy)}
          >
            <SelectTrigger id="debt-strategy" aria-label="Strategy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="snowball">Snowball (smallest balance)</SelectItem>
              <SelectItem value="avalanche">Avalanche (highest rate)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="debt-extra">Extra monthly payment</Label>
          <Input
            id="debt-extra"
            type="number"
            min={0}
            step={50}
            value={values.extraTotal}
            onChange={(e) => {
              const v = Number(e.target.value);
              setValue('extraTotal', Number.isFinite(v) && v >= 0 ? v : 0);
            }}
            disabled={values.strategy === 'none'}
          />
          <p className="text-xs text-muted-foreground">
            {values.strategy === 'none'
              ? 'Pick a strategy to apply additional monthly payments.'
              : values.strategy === 'snowball'
                ? 'Applied to the smallest-balance loan each month.'
                : 'Applied to the highest-rate loan each month.'}
          </p>
        </div>
      </div>

      {/* Gated reset button — only appears when the user has overridden a value */}
      {isOverridden && (
        <button
          type="button"
          onClick={reset}
          className="text-sm text-primary hover:underline"
        >
          Reset to my data
        </button>
      )}

      {/* Per-loan rows */}
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2">Loan</th>
            <th className="py-2 text-right">Balance</th>
            <th className="py-2 text-right">Rate</th>
            <th className="py-2 text-right">Payoff date</th>
            <th className="py-2 text-right">Interest</th>
          </tr>
        </thead>
        <tbody>
          {projections.map((p) => {
            const last = p.amortization.schedule[p.amortization.schedule.length - 1];
            const capped = scheduleIsCapped(p.amortization.schedule);
            return (
              <tr
                key={p.loan.id ?? p.loan.name}
                className="border-t"
                data-testid={`debt-loan-row-${p.loan.id ?? p.loan.name}`}
              >
                <td className="py-2">{p.loan.name}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatCurrency(p.loan.currentBalance)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {/* Intentionally 2 dp for loan APRs (e.g. 5.25%) — standard precision for lending disclosures. */}
                  {(p.loan.interestRate * 100).toFixed(2)}%
                </td>
                <td
                  className="py-2 text-right tabular-nums"
                  data-testid={`debt-loan-payoff-${p.loan.id ?? p.loan.name}`}
                >
                  {capped ? (
                    <span className="text-warning-foreground">Never at this payment</span>
                  ) : (
                    formatPayoffDate(last?.paymentDate)
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {capped ? '—' : formatCurrency(p.amortization.totalInterest)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </CalculatorCard>
  );
}
