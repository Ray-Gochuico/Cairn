import type { MonthlyState } from './engine';
import { totalInvestments } from './aggregate-investments';

export interface FinancialIndependenceParams {
  /** Safe withdrawal rate, e.g. 0.04 for the 4% rule. */
  withdrawalRate: number;
  /**
   * Round-3 M2 (sibling of the FiCards gate): the household's monthly
   * expense baseline. A zero baseline makes the FI target $0 and every
   * month "crosses" it (engine expenses can still be >0 via loan payments),
   * so chips would claim instant FI. `<= 0` → no FI milestone. Omitted →
   * legacy expenses-only behavior (callers without household context).
   */
  monthlyExpenseBaseline?: number;
}

export interface Milestones {
  debtFreeISO?: string;
  financialIndependenceISO?: string;
  /**
   * First month in the projection where every earner's salary has dropped to
   * zero. Marks the accumulation-to-drawdown transition driven by
   * Person.targetRetirementAge or LeverPayload.retirementAgeOverride.
   */
  retirementISO?: string;
  /**
   * Net worth at the 30-year point in the projection, used by the
   * ManageScenariosModal scoreboard. Falls back to the final state's
   * net worth when the horizon is shorter than 30 years.
   */
  netWorth30y?: number;
}

const MONTHS_30Y = 360;

/**
 * Liquid / investable assets used for the FI milestone test. Excludes home
 * equity and vehicles (which can't realistically fund a 4%-SWR drawdown
 * without selling) and excludes outstanding debt (debt is paid down via
 * the household cash-flow plan, not from the SWR pool).
 *
 * Wave-3 Task 4 fix: previously the milestone test used `s.netWorth`, which
 * inflated the SWR pool by home equity. A $1M home owner needed only $500k
 * in investments to "reach FI" by the 4% rule — clearly wrong, since they
 * can't draw 4% from their primary residence.
 *
 * Defensive against legacy state shapes that may lack `investmentsByAccount`
 * (older test fixtures, hand-built mocks). When the field is missing we
 * treat investments as 0.
 */
function liquidAssets(s: MonthlyState): number {
  const investments = s.investmentsByAccount ? totalInvestments(s) : 0;
  return investments + (s.cash ?? 0);
}

export function detectMilestones(
  states: MonthlyState[],
  params: FinancialIndependenceParams,
): Milestones {
  let debtFreeISO: string | undefined;
  let financialIndependenceISO: string | undefined;
  let retirementISO: string | undefined;

  // Round-3 M2: a zero baseline means "no FI target", not "instant FI" —
  // skip the crossing scan entirely so every consumer renders "FI —".
  const fiScanEnabled =
    params.monthlyExpenseBaseline === undefined || params.monthlyExpenseBaseline > 0;

  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const totalDebt = Object.values(s.debtByLoan).reduce((acc, v) => acc + v, 0);
    if (!debtFreeISO && totalDebt === 0) {
      debtFreeISO = s.monthISO;
    }
    if (fiScanEnabled && !financialIndependenceISO) {
      // Use LIQUID (investments + cash), not netWorth. Home equity does not
      // sustain a 4% SWR. The previous calculation inflated FI estimates by
      // years for homeowners.
      const monthlyWithdrawalCapacity = (liquidAssets(s) * params.withdrawalRate) / 12;
      if (monthlyWithdrawalCapacity >= s.expenses && s.expenses > 0) {
        financialIndependenceISO = s.monthISO;
      }
    }
    if (!retirementISO && i > 0 && s.incomeAfterTax === 0 && states[i - 1].incomeAfterTax > 0) {
      retirementISO = s.monthISO;
    }
  }

  const horizonState =
    states.length >= MONTHS_30Y ? states[MONTHS_30Y - 1] : states[states.length - 1];
  const netWorth30y = horizonState ? horizonState.netWorth : undefined;

  return { debtFreeISO, financialIndependenceISO, retirementISO, netWorth30y };
}
