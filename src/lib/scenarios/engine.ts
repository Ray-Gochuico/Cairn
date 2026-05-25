import type { LeverPayload } from './lever-types';
import type { RealState } from './state-snapshot';
import {
  applyAnnualReturn,
  applyLumpSum,
  applyExtraLoanPayment,
  computeMonthlyIncomeForPerson,
  monthlyExpenseDeltaFromPeriods,
  type LoanMonthlyContext,
} from './apply-real';

export interface MonthlyState {
  monthISO: string;
  investments: number;
  homeEquity: number;
  cash: number;
  debtByLoan: Record<number, number>;
  netWorth: number;
  incomeAfterTax: number;
  expenses: number;
  savings: number;
  events: string[];
}

export interface Horizon {
  startISO: string;   // 'YYYY-MM'
  months: number;     // 60..480
}

// Coarse blended effective-tax-rate estimates by filing status for v1 of the engine.
// Refined tax integration is deferred to a follow-up; the data layer in S-B can
// inject a more accurate computeTotalTax via lever payload if needed.
const EFFECTIVE_TAX_RATE_BY_STATUS: Record<string, number> = {
  SINGLE: 0.28,
  MFJ: 0.25,
  MFS: 0.30,
  HOH: 0.26,
};

export function projectScenario(
  real: RealState,
  payload: LeverPayload,
  horizon: Horizon,
): MonthlyState[] {
  const out: MonthlyState[] = [];
  const startYear = Number(horizon.startISO.slice(0, 4));

  const initialInvestments = real.holdings.reduce(
    (acc, h) => acc + h.shareCount * (h.costBasis ?? 0),
    0,
  );

  let state: MonthlyState = {
    monthISO: horizon.startISO,
    investments: initialInvestments,
    homeEquity: 0,
    cash: 0,
    debtByLoan: Object.fromEntries(real.loans.map((l) => [l.id!, l.currentBalance])),
    netWorth: 0,
    incomeAfterTax: 0,
    expenses: 0,
    savings: 0,
    events: [],
  };
  state.netWorth = computeNetWorth(state);
  out.push(state);

  for (let i = 1; i < horizon.months; i++) {
    state = stepMonth(state, real, payload, startYear, i);
    out.push(state);
  }
  return out;
}

function stepMonth(
  prev: MonthlyState,
  real: RealState,
  payload: LeverPayload,
  startYear: number,
  monthIndex: number,
): MonthlyState {
  const monthISO = addMonths(prev.monthISO, 1);
  let s: MonthlyState = { ...prev, monthISO, events: [] };

  // 1. Lump-sum events firing this month
  for (const evt of payload.lumpSums) {
    if (evt.when.slice(0, 7) === monthISO) {
      s = applyLumpSum(s, evt);
    }
  }

  // 2. Compute monthly income across persons
  const persons = (real.household as unknown as { persons?: Array<{ annualSalaryPretax?: number; salary?: number }> }).persons ?? [];
  let monthlyGrossIncome = 0;
  persons.forEach((p, idx) => {
    const plan = payload.income.perPerson[idx] ?? payload.income.perPerson[0];
    const baseSalary = p.annualSalaryPretax ?? p.salary ?? 0;
    monthlyGrossIncome += computeMonthlyIncomeForPerson(baseSalary, plan, monthISO, startYear);
  });

  // 3. Apply a coarse effective tax rate based on filing status (v1 stub).
  const effectiveRate = EFFECTIVE_TAX_RATE_BY_STATUS[real.household.filingStatus] ?? 0.28;
  const monthlyAfterTax = monthlyGrossIncome * (1 - effectiveRate);
  s.incomeAfterTax = monthlyAfterTax;

  // 4. Expenses: baseline trended + period deltas
  const yearsElapsed = monthIndex / 12;
  const inflationFactor = Math.pow(1 + real.defaults.inflation, yearsElapsed);
  const baseExpenses = real.baselineMonthlyExpenses * inflationFactor;
  const periodDelta = monthlyExpenseDeltaFromPeriods(payload.expensePeriods, monthISO);
  s.expenses = baseExpenses + periodDelta;

  // 5. Debt servicing
  let regularLoanPayments = 0;
  let extraLoanPayments = 0;
  for (const loan of real.loans) {
    if (loan.id === undefined) continue;
    const currentBal = s.debtByLoan[loan.id] ?? 0;
    if (currentBal <= 0) continue;
    const ctx: LoanMonthlyContext = {
      loanId: loan.id,
      balance: currentBal,
      annualRate: loan.interestRate,
      regularMonthlyPayment: loan.monthlyPayment,
    };
    const extra = payload.extraLoanPayments.find((e) => e.loanId === loan.id);
    const result = applyExtraLoanPayment(ctx, extra, monthISO);
    s.debtByLoan = { ...s.debtByLoan, [loan.id]: result.newBalance };
    regularLoanPayments += loan.monthlyPayment;
    extraLoanPayments += result.extraApplied;
    if (result.newBalance === 0 && (prev.debtByLoan[loan.id] ?? 0) > 0) {
      s.events.push(`debt_paid_off:${loan.id}`);
    }
  }

  // 6. Savings = income - expenses - loan payments; route to investments
  s.savings = s.incomeAfterTax - s.expenses - regularLoanPayments - extraLoanPayments;
  if (s.savings > 0) s.investments += s.savings;
  else s.cash += s.savings;

  // 7. Apply this month's return to investments
  const year = Number(monthISO.slice(0, 4));
  const annualReturn = payload.returns.overrides[String(year)] ?? payload.returns.defaultRate;
  s = applyAnnualReturn(s, annualReturn);

  s.netWorth = computeNetWorth(s);
  return s;
}

function computeNetWorth(s: MonthlyState): number {
  const debt = Object.values(s.debtByLoan).reduce((a, b) => a + b, 0);
  return s.investments + s.homeEquity + s.cash - debt;
}

function addMonths(monthISO: string, n: number): string {
  const d = new Date(`${monthISO}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
