import { efContext, type BaselineSource } from '@/domain/roadmap/rules/emergencyFund';
import { classifyDebtRate } from '@/domain/roadmap/thresholds';
import type { InterviewContext } from '@/types/interview';
import type { Loan } from '@/types/schema';

export const toCents = (dollars: number): number => Math.round(dollars * 100);

export interface BucketGaps {
  baselineDollars: number;
  baselineSource: BaselineSource;
  reserveDollars: number;
  /** max(0, max($1,000, 1× baseline) − reserve). 0 when baseline missing. */
  efFloorGapCents: number;
  ef3GapCents: number;
  ef6GapCents: number;
  /** Avalanche-ordered active loans per band (CI-25 tie-break). */
  highLoans: Loan[];
  midLoans: Loan[];
  highRateGapCents: number;
  midRateGapCents: number;
  anyLoans: boolean;
}

/** Highest rate first; ties → smaller balance, then lower id (CI-25). */
export function avalancheOrder(loans: Loan[]): Loan[] {
  return [...loans].sort(
    (a, b) =>
      b.interestRate - a.interestRate ||
      a.currentBalance - b.currentBalance ||
      (a.id ?? 0) - (b.id ?? 0),
  );
}

/**
 * The six buckets' gap inputs (design §3.1), every leg bound to an
 * existing engine: reserve + baseline via the roadmap's efContext
 * (CASH+SAVINGS+HSA set, excluded accounts dropped, transactions-first
 * baseline with household fallback); debt bands via classifyDebtRate —
 * NOTE Loan.interestRate is a 0–1 FRACTION, the classifier takes PERCENT
 * (the debtClassification.ts ×100 seam). Pure over ctx.
 */
export function computeBucketGaps(ctx: InterviewContext): BucketGaps {
  const { baseline, cash, baselineSource } = efContext(ctx);
  const active = ctx.loans.filter((l) => l.currentBalance > 0);
  const high = avalancheOrder(active.filter((l) => classifyDebtRate(l.interestRate * 100, ctx.thresholds) === 'high'));
  const mid = avalancheOrder(active.filter((l) => classifyDebtRate(l.interestRate * 100, ctx.thresholds) === 'moderate'));
  const gapTo = (targetDollars: number): number =>
    Math.max(0, toCents(targetDollars) - toCents(cash));
  const noBaseline = baselineSource === 'none';
  return {
    baselineDollars: baseline,
    baselineSource,
    reserveDollars: cash,
    efFloorGapCents: noBaseline ? 0 : gapTo(Math.max(1000, baseline)),
    ef3GapCents: noBaseline ? 0 : gapTo(3 * baseline),
    ef6GapCents: noBaseline ? 0 : gapTo(6 * baseline),
    highLoans: high,
    midLoans: mid,
    highRateGapCents: toCents(high.reduce((s, l) => s + l.currentBalance, 0)),
    midRateGapCents: toCents(mid.reduce((s, l) => s + l.currentBalance, 0)),
    anyLoans: active.length > 0,
  };
}
