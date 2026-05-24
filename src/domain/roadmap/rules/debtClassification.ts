import type { NodeResult, RoadmapContext } from '@/types/roadmap';
import type { Loan } from '@/types/schema';
import { classifyDebtRate } from '../thresholds';

/**
 * Three debt-classification evaluators sharing the same threshold
 * machinery. The chart treats each band as its own gate:
 *   - High-interest (≥ 8% default) blocks Sections 2+ until cleared.
 *   - Moderate (5%–<8%) is Section 2's main focus.
 *   - Low (<5%) is a Section 6 "evaluate" item — paying it down vs.
 *     investing the cashflow is a judgment call rather than an
 *     obligation.
 *
 * `interestRate` is stored as a decimal (0.08 = 8%); we convert to
 * percent before classifying so thresholds.ts stays in human units.
 * Loans with zero current balance are filtered out — they're paid off.
 */
type LoanWithRate = Pick<Loan, 'name' | 'currentBalance' | 'interestRate'>;

function activeLoansInBand(
  loans: LoanWithRate[],
  thresholds: { low: number; high: number },
  band: 'low' | 'moderate' | 'high',
): LoanWithRate[] {
  return loans.filter((l) => {
    if (l.currentBalance <= 0) return false;
    return classifyDebtRate(l.interestRate * 100, thresholds) === band;
  });
}

function listLoans(loans: LoanWithRate[]): string {
  return loans.map((l) => `${l.name} @ ${(l.interestRate * 100).toFixed(2)}%`).join(', ');
}

export function evaluateHighInterestDebt(ctx: RoadmapContext): NodeResult {
  const offenders = activeLoansInBand(ctx.loans, ctx.thresholds, 'high');
  if (offenders.length === 0) {
    return { status: 'done', evidence: `No active loans ≥ ${ctx.thresholds.high}%` };
  }
  const noun = offenders.length === 1 ? 'loan' : 'loans';
  return {
    status: 'active',
    evidence: `${offenders.length} ${noun} ≥ ${ctx.thresholds.high}% — ${listLoans(offenders)}`,
    cta: { label: 'Open Loans →', href: '/loans' },
  };
}

export function evaluateModerateInterestDebt(ctx: RoadmapContext): NodeResult {
  const offenders = activeLoansInBand(ctx.loans, ctx.thresholds, 'moderate');
  if (offenders.length === 0) {
    return {
      status: 'done',
      evidence: `No active loans in the ${ctx.thresholds.low}–${ctx.thresholds.high}% band`,
    };
  }
  const noun = offenders.length === 1 ? 'loan' : 'loans';
  return {
    status: 'active',
    evidence: `${offenders.length} ${noun} in ${ctx.thresholds.low}–${ctx.thresholds.high}% — ${listLoans(offenders)}`,
    cta: { label: 'Open Loans →', href: '/loans' },
  };
}

export function evaluateLowInterestDebt(ctx: RoadmapContext): NodeResult {
  const lows = activeLoansInBand(ctx.loans, ctx.thresholds, 'low');
  if (lows.length === 0) {
    return { status: 'done', evidence: `No active loans below ${ctx.thresholds.low}%` };
  }
  // For Section 6, paying off low-interest debt is a "consider" item,
  // not an obligation. We surface the list as informational so the
  // user can weigh it against investing.
  const noun = lows.length === 1 ? 'loan' : 'loans';
  return {
    status: 'info',
    evidence: `${lows.length} low-interest ${noun} (< ${ctx.thresholds.low}%) — ${listLoans(lows)}`,
    cta: { label: 'Open Loans →', href: '/loans' },
  };
}
