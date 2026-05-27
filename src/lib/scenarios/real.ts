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
    // Optional flow decomposition fields (Task #25) — same `factor` applies.
    // Defined as a small helper so we keep `undefined` distinct from 0
    // (the engine deliberately leaves the seed month undefined; only stepped
    // months populate these fields).
    const scaleOpt = (n: number | undefined): number | undefined =>
      n === undefined ? undefined : n * factor;
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
      compoundReturnAdded: scaleOpt(s.compoundReturnAdded),
      gapToTaxAdvantaged: scaleOpt(s.gapToTaxAdvantaged),
      gapToBrokerage: scaleOpt(s.gapToBrokerage),
      gapToCash: scaleOpt(s.gapToCash),
      leverContributionsInvested: scaleOpt(s.leverContributionsInvested),
      lumpSumInvested: scaleOpt(s.lumpSumInvested),
      withdrawnFromInvestments: scaleOpt(s.withdrawnFromInvestments),
    };
  });
}
