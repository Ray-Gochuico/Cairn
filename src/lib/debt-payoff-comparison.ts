/**
 * Wave 18 D11 — always-computed Avalanche | Snowball comparison. Pure; the
 * card renders BOTH outcomes side by side and the strategy select only
 * highlights one (never gates the math). The all-minimums baseline moved
 * here verbatim from DebtPayoffCard's baseline useMemo so the card and tests
 * share one implementation.
 */
import { amortize, nextPaymentDateFrom, scheduleIsCapped } from '@/lib/amortization';
import {
  pickStrategyTargetIndex,
  projectionsFor,
  type Strategy,
  type LoanProjection,
} from '@/lib/debt-payoff';
import type { Loan } from '@/types/schema';

export interface StrategyOutcome {
  strategy: Extract<Strategy, 'avalanche' | 'snowball'>;
  projections: LoanProjection[];
  /** Latest schedule end across loans (ISO), null when no schedules. */
  payoffDate: string | null;
  totalInterest: number;
  /** vs the all-minimums baseline (extra = 0 everywhere, incl. defaults' extra). */
  savedVsMinimums: number;
  /** Any loan capped → date/interest are lies; the card suppresses them. */
  anyCapped: boolean;
  /** Baseline capped → savings comparison is meaningless (rescued case). */
  savingsCapped: boolean;
}

export interface DebtComparison {
  avalanche: StrategyOutcome;
  snowball: StrategyOutcome;
  /** Positive = avalanche saves this much interest over snowball. */
  interestDelta: number;
  /** Whole months between the two payoff dates (positive = avalanche sooner). */
  monthsDelta: number | null;
  /** True when the strategies produce identical schedules (e.g. one loan). */
  identical: boolean;
  baselineInterest: number;
  baselineCappedNames: string[];
}

function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm] = [Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7))];
  const [ty, tm] = [Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7))];
  return (ty - fy) * 12 + (tm - fm);
}

function outcomeFor(
  strategy: Extract<Strategy, 'avalanche' | 'snowball'>,
  loans: Loan[],
  extraTotal: number,
  todayIso: string,
  baseline: { interest: number; cappedNames: string[] },
): StrategyOutcome {
  const projections = projectionsFor(loans, strategy, extraTotal, todayIso);
  const anyCapped = projections.some((p) => scheduleIsCapped(p.amortization.schedule));
  const totalInterest = projections.reduce((a, p) => a + p.amortization.totalInterest, 0);
  // Latest schedule end across loans; ISO strings sort as dates do.
  const lastDates = projections
    .map((p) => p.amortization.schedule[p.amortization.schedule.length - 1]?.paymentDate)
    .filter((d): d is string => Boolean(d));
  const payoffDate =
    lastDates.length > 0 ? lastDates.reduce((latest, d) => (d > latest ? d : latest)) : null;
  return {
    strategy,
    projections,
    payoffDate,
    totalInterest,
    savedVsMinimums: Math.max(0, baseline.interest - totalInterest),
    anyCapped,
    // Rescued-baseline rule (review F1): savings differences the extra-less
    // baseline, so EITHER side capped poisons the comparison.
    savingsCapped: anyCapped || baseline.cappedNames.length > 0,
  };
}

export function compareStrategies(
  loans: Loan[],
  extraTotal: number,
  todayIso: string,
): DebtComparison {
  // All-minimums baseline (extraPayment 0 for EVERY loan) — moved verbatim
  // from DebtPayoffCard's baseline useMemo so the card and tests share one
  // implementation.
  let baselineInterest = 0;
  const baselineCappedNames: string[] = [];
  for (const loan of loans) {
    const a = amortize({
      principal: loan.currentBalance,
      annualRatePct: loan.interestRate,
      termMonths: loan.termMonths,
      firstPaymentDate: nextPaymentDateFrom(loan.firstPaymentDate, todayIso),
      monthlyPayment: loan.monthlyPayment,
      extraPayment: 0,
    });
    baselineInterest += a.totalInterest;
    if (scheduleIsCapped(a.schedule)) baselineCappedNames.push(loan.name);
  }
  const baseline = { interest: baselineInterest, cappedNames: baselineCappedNames };
  const avalanche = outcomeFor('avalanche', loans, extraTotal, todayIso, baseline);
  const snowball = outcomeFor('snowball', loans, extraTotal, todayIso, baseline);
  const identical =
    loans.length <= 1 ||
    pickStrategyTargetIndex(loans, 'avalanche') === pickStrategyTargetIndex(loans, 'snowball');
  const monthsDelta =
    !avalanche.anyCapped && !snowball.anyCapped && avalanche.payoffDate && snowball.payoffDate
      ? monthsBetween(avalanche.payoffDate, snowball.payoffDate)
      : null;
  return {
    avalanche,
    snowball,
    interestDelta: snowball.totalInterest - avalanche.totalInterest,
    monthsDelta,
    identical,
    baselineInterest,
    baselineCappedNames,
  };
}
