import type { MonthlyState } from './engine';

export function toReal(states: MonthlyState[], inflation: number, startISO: string): MonthlyState[] {
  const [startY, startM] = startISO.split('-').map(Number);
  return states.map((s) => {
    const [y, m] = s.monthISO.split('-').map(Number);
    const monthsElapsed = (y - startY) * 12 + (m - startM);
    const yearsElapsed = monthsElapsed / 12;
    const factor = 1 / Math.pow(1 + inflation, yearsElapsed);
    const deflatedAccounts: Record<number, number> = {};
    for (const [idStr, balance] of Object.entries(s.investmentsByAccount)) {
      deflatedAccounts[Number(idStr)] = balance * factor;
    }
    return {
      ...s,
      investmentsByAccount: deflatedAccounts,
      homeEquity: s.homeEquity * factor,
      cash: s.cash * factor,
      netWorth: s.netWorth * factor,
      incomeAfterTax: s.incomeAfterTax * factor,
      expenses: s.expenses * factor,
      savings: s.savings * factor,
      debtByLoan: Object.fromEntries(Object.entries(s.debtByLoan).map(([k, v]) => [k, v * factor])),
    };
  });
}
