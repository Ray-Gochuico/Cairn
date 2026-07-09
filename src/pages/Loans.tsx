import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { useLoadGate } from '@/lib/use-load-gate';
import PageLoadingSpinner from '@/components/layout/PageLoadingSpinner';
import { useLoansStore } from '@/stores/loans-store';
import { amortize, nextPaymentDateFrom, scheduleIsCapped, type Amortization, type ScheduleEntry } from '@/lib/amortization';
import { filterByObligorPersonId } from '@/lib/filter-by-view';
import { useViewFilter } from '@/lib/use-view-filter';
import { LoanType } from '@/types/enums';
import type { Loan } from '@/types/schema';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import BarChartCard, { type BarChartSeries } from '@/components/charts/BarChartCard';
import { Button } from '@/components/ui/button';
import { ExportCsvButton } from '@/components/ExportCsvButton';
import type { CsvColumn } from '@/lib/csv';
import { PageContainer } from '@/components/layout/PageContainer';
import { StoreErrorBanner } from '@/components/layout/StoreErrorBanner';
import { EmptyState } from '@/components/layout/EmptyState';

/**
 * Loans page — Phase 2 visualization surface.
 *
 * Per-loan amortization is computed via `amortize()` directly (not via
 * LoansRepo.projectedSchedule, which is async + per-id). For a page that
 * needs to schedule every loan synchronously to feed a Recharts series,
 * pulling the same loan rows from the store and calling `amortize()`
 * straight is simpler and keeps a single source of truth for the
 * "current balance forward" projection. Schedules use the loan's CONTRACT
 * monthlyPayment anchored at the next payment date from today (falling back
 * to a derived payment when monthlyPayment is 0/unset).
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

function projectLoan(loan: Loan, todayIso: string): LoanProjection {
  // REMAINING-schedule projection: contract payment + next payment date from
  // today (wave-1 review, finding 2 — re-deriving a payment from the original
  // term overstated remaining interest and dated the schedule in the past).
  const base = {
    principal: loan.currentBalance,
    annualRatePct: loan.interestRate,
    termMonths: loan.termMonths,
    firstPaymentDate: nextPaymentDateFrom(loan.firstPaymentDate, todayIso),
    monthlyPayment: loan.monthlyPayment,
  };
  const withDefault = amortize({ ...base, extraPayment: loan.extraPaymentDefault });
  const withoutExtra = loan.extraPaymentDefault > 0
    ? amortize({ ...base, extraPayment: 0 })
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
 * One row of the stacked debt series. The row carries one numeric column per
 * loan type present in the household ('MORTGAGE', 'AUTO', …); each column is
 * the summed remaining balance for loans of that type in the given month.
 * Months past a given loan's payoff implicitly contribute 0 to that type.
 */
export interface DebtSeriesRow {
  month: string;
  [loanTypeKey: string]: string | number;
}

/**
 * Build the stacked "total debt over time" series. Buckets every projection
 * entry by YYYY-MM month *and* loan type so the chart can stack one segment
 * per type. Only types with at least one loan in the visible set get a
 * column — otherwise Recharts would render empty bars (and the legend would
 * list types the household doesn't have).
 *
 * Returns the rows (capped at MAX_CHART_MONTHS) and the ordered list of
 * loan types present, so the chart knows how many series to draw.
 */
export function buildDebtSeries(
  projections: LoanProjection[],
  todayIso: string,
): {
  rows: DebtSeriesRow[];
  typesPresent: LoanType[];
} {
  if (projections.length === 0) return { rows: [], typesPresent: [] };
  // Preserve LOAN_TYPE_LABEL order so the legend reads consistently.
  const orderedTypes: LoanType[] = Object.keys(LOAN_TYPE_LABEL) as LoanType[];
  const typesPresent = orderedTypes.filter((t) =>
    projections.some((p) => p.loan.type === t),
  );

  const rowsByMonth = new Map<string, DebtSeriesRow>();
  // Wave-9 M10: schedules start at the NEXT due date, so a loan due next
  // month has no entry for the CURRENT month — its whole balance silently
  // vanished from the chart's first bar (contradicting the tile above).
  // Seed the current month with currentBalance for any such loan.
  const currentMonth = todayIso.slice(0, 7);
  for (const p of projections) {
    const firstMonth = p.withDefault.schedule[0]?.paymentDate.slice(0, 7);
    if (firstMonth && firstMonth > currentMonth) {
      let row = rowsByMonth.get(currentMonth);
      if (!row) {
        row = { month: currentMonth };
        for (const tp of typesPresent) row[tp] = 0;
        rowsByMonth.set(currentMonth, row);
      }
      row[p.loan.type] = (row[p.loan.type] as number) + p.loan.currentBalance;
    }
  }
  for (const p of projections) {
    const t = p.loan.type;
    for (const entry of p.withDefault.schedule) {
      const month = entry.paymentDate.slice(0, 7);
      let row = rowsByMonth.get(month);
      if (!row) {
        row = { month };
        for (const tp of typesPresent) row[tp] = 0;
        rowsByMonth.set(month, row);
      }
      row[t] = (row[t] as number) + entry.balance;
    }
  }

  const rows = [...rowsByMonth.values()]
    .sort((a, b) => (a.month as string).localeCompare(b.month as string))
    .slice(0, MAX_CHART_MONTHS);
  return { rows, typesPresent };
}

// ---------------------------------------------------------------------------
// AmortizationTable
// ---------------------------------------------------------------------------

function AmortizationTable({ schedule }: { schedule: ScheduleEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const truncated = schedule.length > 60 && !showAll;
  const head = truncated ? schedule.slice(0, 12) : schedule;
  const tail = truncated ? schedule.slice(-12) : [];

  return (
    <div className="min-w-[480px]">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-2 font-medium">Date</th>
            <th className="py-2 font-medium text-right">Principal</th>
            <th className="py-2 font-medium text-right">Interest</th>
            <th className="py-2 font-medium text-right">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {head.map((row, i) => (
            <tr key={`h-${i}`} className="border-b last:border-b-0">
              <td className="py-1.5">{row.paymentDate}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCurrency(row.principal)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCurrency(row.interest)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCurrency(row.balance)}</td>
            </tr>
          ))}
          {truncated && (
            <tr className="border-b">
              <td colSpan={4} className="py-2 text-center text-muted-foreground italic">
                … {schedule.length - 24} payments omitted …
              </td>
            </tr>
          )}
          {tail.map((row, i) => (
            <tr key={`t-${i}`} className="border-b last:border-b-0">
              <td className="py-1.5">{row.paymentDate}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCurrency(row.principal)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCurrency(row.interest)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCurrency(row.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {schedule.length > 60 && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-sm text-primary hover:underline"
          >
            {showAll ? 'Show first/last 12' : `Show all ${schedule.length} payments`}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoanCard
// ---------------------------------------------------------------------------

interface LoanCardProps {
  projection: LoanProjection;
  expanded: boolean;
  onToggleExpand: () => void;
  schedule: ScheduleEntry[];
}

function LoanCard({ projection, expanded, onToggleExpand, schedule }: LoanCardProps) {
  const { loan, withDefault, withoutExtra } = projection;
  const loanId = loan.id!;
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

  // Round-2 A1 (same class as DebtPayoffCard): a capped schedule's tail is
  // the safety cap, not a payoff. Each figure suppresses based on the
  // schedule that produced it; the savings box needs BOTH schedules honest.
  const capped = scheduleIsCapped(withDefault.schedule);
  const savingsCapped = capped || (hasExtra && scheduleIsCapped(withoutExtra.schedule));

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
        {capped && (
          <div
            role="note"
            className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-foreground"
          >
            This loan never pays off at the current payment.
          </div>
        )}
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
              className="h-full bg-success transition-all"
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
            <dd className="font-medium">{capped ? '—' : payoffDate}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Remaining interest
            </dt>
            <dd className="font-medium">{capped ? '—' : formatCurrency(withDefault.totalInterest)}</dd>
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

        {hasExtra && !savingsCapped ? (
          <div className="rounded-md bg-success-soft border border-success/30 px-3 py-2 text-sm text-success-foreground">
            <div className="font-medium">
              With {formatCurrency(loan.extraPaymentDefault)}/mo extra
            </div>
            <div className="text-xs mt-0.5">
              Payoff {payoffDate} vs {payoffDateNoExtra} · save{' '}
              <span className="font-semibold">{formatCurrency(interestSavings)}</span> in interest
            </div>
          </div>
        ) : null}

        <div>
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-controls={`loan-schedule-${loanId}`}
            className="text-sm text-primary hover:underline"
          >
            {expanded ? 'Hide schedule' : 'View schedule'}
          </button>
        </div>

        {expanded && (
          <div id={`loan-schedule-${loanId}`} className="mt-3 overflow-x-auto">
            <AmortizationTable schedule={schedule} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Loans() {
  const { filter, persons } = useViewFilter();
  const loans = useLoansStore((s) => s.loans);
  const load = useLoansStore((s) => s.load);
  const loansError = useLoansStore((s) => s.error);
  const loansLoading = useLoansStore((s) => s.isLoading);
  const storeErrors = [loansError];
  const hasStoreError = loansError != null;
  const gate = useLoadGate([loansLoading], storeErrors, load);

  const [expandedLoanIds, setExpandedLoanIds] = useState<Set<number>>(new Set());

  function toggleExpanded(loanId: number) {
    setExpandedLoanIds((prev) => {
      const next = new Set(prev);
      if (next.has(loanId)) next.delete(loanId);
      else next.add(loanId);
      return next;
    });
  }


  // Filter loans by the household / p1 / p2 / joint dropdown. Every
  // downstream derivation (projections, totals, debt series) reads from
  // visibleLoans so the dropdown reaches the entire page.
  const visibleLoans = useMemo(
    () => filterByObligorPersonId(loans, filter, persons),
    [loans, filter, persons],
  );

  // One "today" per mount: anchors every remaining schedule consistently.
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const projections = useMemo(
    () => visibleLoans.map((l) => projectLoan(l, todayIso)),
    [visibleLoans, todayIso],
  );

  // Compute amortization schedules only for loans the user has expanded, to
  // avoid recomputing entire schedules on every unrelated re-render.
  const schedulesByLoanId = useMemo(() => {
    const map = new Map<number, ScheduleEntry[]>();
    for (const loan of visibleLoans) {
      if (!expandedLoanIds.has(loan.id!)) continue;
      map.set(
        loan.id!,
        amortize({
          principal: loan.currentBalance,
          annualRatePct: loan.interestRate,
          termMonths: loan.termMonths,
          firstPaymentDate: nextPaymentDateFrom(loan.firstPaymentDate, todayIso),
          monthlyPayment: loan.monthlyPayment,
          extraPayment: loan.extraPaymentDefault,
        }).schedule,
      );
    }
    return map;
  }, [visibleLoans, expandedLoanIds, todayIso]);

  const totalDebt = useMemo(
    () => visibleLoans.reduce((sum, l) => sum + l.currentBalance, 0),
    [visibleLoans],
  );

  const totalMonthlyPayment = useMemo(
    () => visibleLoans.reduce((sum, l) => sum + l.monthlyPayment, 0),
    [visibleLoans],
  );

  const remainingInterest = useMemo(
    () => projections.reduce((sum, p) => sum + p.withDefault.totalInterest, 0),
    [projections],
  );

  // Round-2 A1: any capped schedule poisons the interest sum — suppress the
  // aggregate tile rather than present the cap's accumulation as real.
  const anyCapped = useMemo(
    () => projections.some((p) => scheduleIsCapped(p.withDefault.schedule)),
    [projections],
  );

  const { rows: debtRows, typesPresent: debtTypes } = useMemo(
    () => buildDebtSeries(projections, todayIso),
    [projections, todayIso],
  );

  const debtChartSeries = useMemo<BarChartSeries[]>(
    () =>
      debtTypes.map((t) => ({
        dataKey: t,
        label: LOAN_TYPE_LABEL[t],
        stackId: 'debt',
      })),
    [debtTypes],
  );

  const personNameById = useMemo(
    () =>
      new Map(
        persons.filter((p) => p.id != null).map((p) => [p.id as number, p.name]),
      ),
    [persons],
  );

  const csvColumns = useMemo<CsvColumn<Loan>[]>(
    () => [
      { header: 'name', value: (l) => l.name },
      { header: 'type', value: (l) => LOAN_TYPE_LABEL[l.type] },
      { header: 'original amount', value: (l) => l.originalAmount },
      { header: 'current balance', value: (l) => l.currentBalance },
      { header: 'interest rate', value: (l) => l.interestRate },
      { header: 'term months', value: (l) => l.termMonths },
      { header: 'monthly payment', value: (l) => l.monthlyPayment },
      {
        header: 'obligor',
        value: (l) =>
          l.obligorPersonId != null
            ? (personNameById.get(l.obligorPersonId) ?? '')
            : '',
      },
    ],
    [personNameById],
  );

  if (!gate.settled) {
    return (
      <PageContainer className="space-y-6">
        <PageLoadingSpinner />
      </PageContainer>
    );
  }

  if (loans.length === 0) {
    return (
      <PageContainer className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Loans</h1>
          <p className="text-sm text-muted-foreground">
            Track each debt's payoff curve and total interest at a glance.
          </p>
        </div>
        {hasStoreError ? (
          <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
        ) : (
          <EmptyState
            icon={Landmark}
            title="No loans yet"
            description="Add one in Inputs to see its payoff curve and total interest."
          >
            <Button asChild>
              <Link to="/inputs/loans">Add a loan</Link>
            </Button>
          </EmptyState>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-6">
      <StoreErrorBanner errors={gate.errors} onRetry={gate.retry} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Loans</h1>
          <p className="text-sm text-muted-foreground">
            Per-loan amortization projected from each loan's current balance.
          </p>
        </div>
        <ExportCsvButton baseName="loans" columns={csvColumns} rows={loans} />
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
              Across {visibleLoans.length} loan{visibleLoans.length === 1 ? '' : 's'}
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
              Remaining interest
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">
              {anyCapped ? '—' : formatCurrency(remainingInterest)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {anyCapped
                ? 'Hidden — a payment below interest never pays off'
                : 'On remaining payments at current rates'}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {projections.map((p) => (
          <LoanCard
            key={p.loan.id}
            projection={p}
            expanded={expandedLoanIds.has(p.loan.id!)}
            onToggleExpand={() => toggleExpanded(p.loan.id!)}
            schedule={schedulesByLoanId.get(p.loan.id!) ?? []}
          />
        ))}
      </div>

      {debtRows.length > 0 ? (
        <BarChartCard
          title="Total debt over time"
          subtitle={
            debtTypes.length > 1
              ? 'Remaining balances stacked by loan type'
              : 'Sum of remaining balances per amortization schedule'
          }
          data={debtRows}
          xKey="month"
          series={debtChartSeries}
          yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
      ) : null}
    </PageContainer>
  );
}
