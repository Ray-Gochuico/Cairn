import { useMemo } from 'react';
import { useLoansStore } from '@/stores/loans-store';
import { amortize, type Amortization } from '@/lib/amortization';
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
import type { Loan } from '@/types/schema';

export type Strategy = 'none' | 'snowball' | 'avalanche';

interface DebtPayoffCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

interface LoanProjection {
  loan: Loan;
  amortization: Amortization;
  /** Computed extra-payment that was applied for this loan (default + strategy share). */
  extraApplied: number;
}

/**
 * Pick the index of the loan that should receive the global "extra" payment
 * for a given strategy. Snowball: smallest balance first. Avalanche: highest
 * rate first. Returns -1 when there's nothing to target.
 *
 * v1 limitation: a SINGLE loan receives the entire extra each month. We do
 * NOT model the "snowball cascade" where, after the targeted loan is paid
 * off, the freed-up payment rolls onto the next loan in priority order.
 * Adding a true cascade requires a coupled month-by-month simulation across
 * all loans (the per-loan amortize() runs are independent today). Future
 * iteration.
 *
 * Exported for unit testing.
 */
export function pickStrategyTargetIndex(loans: Loan[], strategy: Strategy): number {
  if (loans.length === 0) return -1;
  if (strategy === 'none') return -1;
  let bestIdx = 0;
  for (let i = 1; i < loans.length; i++) {
    if (strategy === 'snowball') {
      if (loans[i].currentBalance < loans[bestIdx].currentBalance) bestIdx = i;
    } else {
      // avalanche
      if (loans[i].interestRate > loans[bestIdx].interestRate) bestIdx = i;
    }
  }
  return bestIdx;
}

/** Exported for unit testing. */
export function projectionsFor(
  loans: Loan[],
  strategy: Strategy,
  extraTotal: number,
): LoanProjection[] {
  const targetIdx = pickStrategyTargetIndex(loans, strategy);
  return loans.map((loan, i) => {
    const strategyExtra =
      strategy !== 'none' && i === targetIdx ? Math.max(0, extraTotal) : 0;
    const extraApplied = loan.extraPaymentDefault + strategyExtra;
    const amortization = amortize({
      principal: loan.currentBalance,
      annualRatePct: loan.interestRate,
      termMonths: loan.termMonths,
      firstPaymentDate: loan.firstPaymentDate,
      extraPayment: extraApplied,
    });
    return { loan, amortization, extraApplied };
  });
}

export function DebtPayoffCard({ cardId, onHide }: DebtPayoffCardProps = {}) {
  const loans = useLoansStore((s) => s.loans);

  const defaults = useMemo(() => ({ strategy: 'none' as Strategy, extraTotal: 0 }), []);
  const { values, setValue, reset, isOverridden } = useCalculatorState(
    cardId ?? 'debt-payoff',
    defaults,
  );

  const projections = useMemo(
    () => projectionsFor(loans, values.strategy, values.extraTotal),
    [loans, values.strategy, values.extraTotal],
  );

  // Baseline: every loan with extraPayment=0. Used to estimate "savings" from
  // the user's combined defaults + strategy choice. Recomputed only when the
  // loan set changes.
  const baselineInterest = useMemo(() => {
    let sum = 0;
    for (const loan of loans) {
      const a = amortize({
        principal: loan.currentBalance,
        annualRatePct: loan.interestRate,
        termMonths: loan.termMonths,
        firstPaymentDate: loan.firstPaymentDate,
        extraPayment: 0,
      });
      sum += a.totalInterest;
    }
    return sum;
  }, [loans]);

  if (loans.length === 0) {
    return (
      <CalculatorCard
        cardId={cardId}
        onHide={onHide}
        title="Debt Payoff"
        headline="—"
      >
        <p className="text-sm text-muted-foreground">
          Add loans on the Inputs page to see payoff projections.
        </p>
      </CalculatorCard>
    );
  }

  const totalBalance = loans.reduce((a, l) => a + l.currentBalance, 0);
  const totalInterest = projections.reduce(
    (a, p) => a + p.amortization.totalInterest,
    0,
  );
  const interestSavings = Math.max(0, baselineInterest - totalInterest);

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
          {formatCurrency(totalBalance)}
        </span>
      }
    >
      {/* Aggregate metric strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-md border bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground">Total interest</div>
          <div
            className="text-base font-semibold tabular-nums"
            data-testid="debt-total-interest"
          >
            {formatCurrency(totalInterest)}
          </div>
        </div>
        <div className="rounded-md border bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground">
            Estimated payoff
          </div>
          <div
            className="text-base font-semibold tabular-nums"
            data-testid="debt-aggregate-payoff"
          >
            {aggregatePayoffDate ?? '—'}
          </div>
        </div>
        <div className="rounded-md border bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground">
            Savings vs no-extra
          </div>
          <div
            className="text-base font-semibold tabular-nums"
            data-testid="debt-savings"
          >
            {formatCurrency(interestSavings)}
          </div>
        </div>
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
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2">Loan</th>
            <th className="py-2">Balance</th>
            <th className="py-2">Rate</th>
            <th className="py-2">Payoff date</th>
            <th className="py-2">Interest</th>
          </tr>
        </thead>
        <tbody>
          {projections.map((p) => {
            const last = p.amortization.schedule[p.amortization.schedule.length - 1];
            return (
              <tr
                key={p.loan.id ?? p.loan.name}
                className="border-t"
                data-testid={`debt-loan-row-${p.loan.id ?? p.loan.name}`}
              >
                <td className="py-2">{p.loan.name}</td>
                <td className="py-2 tabular-nums">
                  {formatCurrency(p.loan.currentBalance)}
                </td>
                <td className="py-2 tabular-nums">
                  {(p.loan.interestRate * 100).toFixed(2)}%
                </td>
                <td
                  className="py-2 tabular-nums"
                  data-testid={`debt-loan-payoff-${p.loan.id ?? p.loan.name}`}
                >
                  {last?.paymentDate ?? '—'}
                </td>
                <td className="py-2 tabular-nums">
                  {formatCurrency(p.amortization.totalInterest)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </CalculatorCard>
  );
}
