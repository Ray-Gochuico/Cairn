import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLoansStore } from '@/stores/loans-store';
import { amortize, type Amortization } from '@/lib/amortization';
import { LoanType } from '@/types/enums';
import type { Loan } from '@/types/schema';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import LineChartCard from '@/components/charts/LineChartCard';

/**
 * Loans page — Phase 2 visualization surface.
 *
 * Per-loan amortization is computed via `amortize()` directly (not via
 * LoansRepo.projectedSchedule, which is async + per-id). For a page that
 * needs to schedule every loan synchronously to feed a Recharts series,
 * pulling the same loan rows from the store and calling `amortize()`
 * straight is simpler and keeps a single source of truth for the
 * "current balance forward" projection.
 *
 * Recharts only enters via the chart card wrapper (no Recharts import).
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  MORTGAGE: 'Mortgage',
  AUTO: 'Auto',
  STUDENT: 'Student',
  PERSONAL: 'Personal',
  CREDIT_CARD: 'Credit Card',
  OTHER: 'Other',
};

/**
 * Cap the aggregate debt-down chart at this many months. Long-tail mortgages
 * already top out around 360; allowing 480 leaves headroom for unusually
 * long terms without letting a pathological loan (e.g., wrong interest rate
 * triggering near-zero amortization) blow up the series.
 */
const MAX_CHART_MONTHS = 480;

interface LoanProjection {
  loan: Loan;
  /** Schedule using the loan's stored extraPaymentDefault (>= 0). */
  withDefault: Amortization;
  /** Schedule with extraPayment forced to 0. Same regardless of extraPaymentDefault. */
  withoutExtra: Amortization;
}

function projectLoan(loan: Loan): LoanProjection {
  const withDefault = amortize({
    principal: loan.currentBalance,
    annualRatePct: loan.interestRate,
    termMonths: loan.termMonths,
    firstPaymentDate: loan.firstPaymentDate,
    extraPayment: loan.extraPaymentDefault,
  });
  const withoutExtra = loan.extraPaymentDefault > 0
    ? amortize({
        principal: loan.currentBalance,
        annualRatePct: loan.interestRate,
        termMonths: loan.termMonths,
        firstPaymentDate: loan.firstPaymentDate,
        extraPayment: 0,
      })
    : withDefault;
  return { loan, withDefault, withoutExtra };
}

function formatPaymentMonth(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Build an aggregate "total debt over time" series. We take each loan's
 * projected schedule (using its stored extra-payment default), align by the
 * YYYY-MM bucket of each payment, and sum balances. Months past a given
 * loan's payoff implicitly contribute 0 to that loan's term.
 *
 * Returns at most MAX_CHART_MONTHS rows.
 */
function buildDebtSeries(
  projections: LoanProjection[],
): { month: string; total: number }[] {
  if (projections.length === 0) return [];
  const byMonth = new Map<string, number>();
  let maxMonths = 0;
  for (const p of projections) {
    if (p.withDefault.schedule.length > maxMonths) {
      maxMonths = p.withDefault.schedule.length;
    }
    for (const entry of p.withDefault.schedule) {
      const month = entry.paymentDate.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + entry.balance);
    }
  }
  // Sorted ascending by YYYY-MM string (lexicographic === chronological).
  const result = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));
  return result.slice(0, MAX_CHART_MONTHS);
}

interface LoanCardProps {
  projection: LoanProjection;
}

function LoanCard({ projection }: LoanCardProps) {
  const { loan, withDefault, withoutExtra } = projection;
  const paid = Math.max(0, loan.originalAmount - loan.currentBalance);
  const paidPct = loan.originalAmount > 0
    ? Math.min(100, Math.max(0, (paid / loan.originalAmount) * 100))
    : 0;
  const lastEntry = withDefault.schedule[withDefault.schedule.length - 1];
  const payoffDate = lastEntry ? formatPaymentMonth(lastEntry.paymentDate) : '—';

  const hasExtra = loan.extraPaymentDefault > 0;
  const interestSavings = hasExtra
    ? Math.max(0, withoutExtra.totalInterest - withDefault.totalInterest)
    : 0;
  const lastNoExtraEntry = hasExtra
    ? withoutExtra.schedule[withoutExtra.schedule.length - 1]
    : null;
  const payoffDateNoExtra = lastNoExtraEntry
    ? formatPaymentMonth(lastNoExtraEntry.paymentDate)
    : '—';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{loan.name}</CardTitle>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground bg-muted rounded px-2 py-1">
            {LOAN_TYPE_LABEL[loan.type]}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">
              Paid {formatCurrency(paid)}
            </span>
            <span className="font-mono">
              {formatCurrency(loan.currentBalance)} remaining
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(paidPct)}
            aria-label={`${loan.name} paid down`}
          >
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${paidPct}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {paidPct.toFixed(1)}% paid off of {formatCurrency(loan.originalAmount)}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Projected payoff
            </dt>
            <dd className="font-medium">{payoffDate}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Lifetime interest
            </dt>
            <dd className="font-medium">{formatCurrency(withDefault.totalInterest)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Monthly payment
            </dt>
            <dd className="font-medium">{formatCurrency(loan.monthlyPayment)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Rate
            </dt>
            <dd className="font-medium">{(loan.interestRate * 100).toFixed(2)}%</dd>
          </div>
        </dl>

        {hasExtra ? (
          <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">
            <div className="font-medium">
              With {formatCurrency(loan.extraPaymentDefault)}/mo extra
            </div>
            <div className="text-xs mt-0.5">
              Payoff {payoffDate} vs {payoffDateNoExtra} · save{' '}
              <span className="font-semibold">{formatCurrency(interestSavings)}</span> in interest
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function Loans() {
  const loans = useLoansStore((s) => s.loans);
  const load = useLoansStore((s) => s.load);

  useEffect(() => {
    load();
  }, [load]);

  const projections = useMemo(
    () => loans.map(projectLoan),
    [loans],
  );

  const totalDebt = useMemo(
    () => loans.reduce((sum, l) => sum + l.currentBalance, 0),
    [loans],
  );

  const totalMonthlyPayment = useMemo(
    () => loans.reduce((sum, l) => sum + l.monthlyPayment, 0),
    [loans],
  );

  const lifetimeInterest = useMemo(
    () => projections.reduce((sum, p) => sum + p.withDefault.totalInterest, 0),
    [projections],
  );

  const debtSeries = useMemo(() => buildDebtSeries(projections), [projections]);

  if (loans.length === 0) {
    return (
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-semibold mb-1">Loans</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Track each debt's payoff curve and total interest at a glance.
        </p>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No loans yet — add one from{' '}
            <Link to="/inputs/loans" className="underline text-foreground">
              Inputs → Loans
            </Link>
            .
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Loans</h1>
        <p className="text-sm text-muted-foreground">
          Per-loan amortization projected from each loan's current balance.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">
              Total debt
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatCurrency(totalDebt)}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Across {loans.length} loan{loans.length === 1 ? '' : 's'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">
              Total monthly payment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatCurrency(totalMonthlyPayment)}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Scheduled monthly outflow
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase tracking-wider">
              Lifetime interest
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatCurrency(lifetimeInterest)}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              If held to maturity at current rates
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {projections.map((p) => (
          <LoanCard key={p.loan.id} projection={p} />
        ))}
      </div>

      {debtSeries.length > 0 ? (
        <LineChartCard
          title="Total debt over time"
          subtitle="Sum of remaining balances per amortization schedule"
          data={debtSeries}
          xKey="month"
          series={[{ dataKey: 'total', label: 'Total debt' }]}
          yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
      ) : null}
    </div>
  );
}
