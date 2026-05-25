import type { MonthlyState } from './engine';

export interface FireParams {
  /** Safe withdrawal rate, e.g. 0.04 for the 4% rule. */
  withdrawalRate: number;
}

export interface Milestones {
  debtFreeISO?: string;
  fireISO?: string;
}

export function detectMilestones(states: MonthlyState[], params: FireParams): Milestones {
  let debtFreeISO: string | undefined;
  let fireISO: string | undefined;

  for (const s of states) {
    const totalDebt = Object.values(s.debtByLoan).reduce((acc, v) => acc + v, 0);
    if (!debtFreeISO && totalDebt === 0) {
      debtFreeISO = s.monthISO;
    }
    if (!fireISO) {
      const monthlyWithdrawalCapacity = (s.netWorth * params.withdrawalRate) / 12;
      if (monthlyWithdrawalCapacity >= s.expenses && s.expenses > 0) {
        fireISO = s.monthISO;
      }
    }
    if (debtFreeISO && fireISO) break;
  }

  return { debtFreeISO, fireISO };
}
