import type { MonthlyState } from './engine';

export interface FinancialIndependenceParams {
  /** Safe withdrawal rate, e.g. 0.04 for the 4% rule. */
  withdrawalRate: number;
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

export function detectMilestones(
  states: MonthlyState[],
  params: FinancialIndependenceParams,
): Milestones {
  let debtFreeISO: string | undefined;
  let financialIndependenceISO: string | undefined;
  let retirementISO: string | undefined;

  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const totalDebt = Object.values(s.debtByLoan).reduce((acc, v) => acc + v, 0);
    if (!debtFreeISO && totalDebt === 0) {
      debtFreeISO = s.monthISO;
    }
    if (!financialIndependenceISO) {
      const monthlyWithdrawalCapacity = (s.netWorth * params.withdrawalRate) / 12;
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
