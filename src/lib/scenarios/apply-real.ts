import type { MonthlyState } from './engine';
import type { ExpensePeriod, ExtraLoanPayment, IncomeEvent, LumpSumEvent, PersonIncomePlan } from './lever-types';

/** Converts an annual return to a monthly return that compounds back to the annual. */
export function monthlyReturnFromAnnual(annual: number): number {
  return Math.pow(1 + annual, 1 / 12) - 1;
}

export function applyAnnualReturn(state: MonthlyState, annualReturn: number): MonthlyState {
  const m = monthlyReturnFromAnnual(annualReturn);
  return { ...state, investments: state.investments * (1 + m) };
}

export function applyLumpSum(state: MonthlyState, evt: LumpSumEvent): MonthlyState {
  if (evt.destination === 'investments') {
    return { ...state, investments: state.investments + evt.amount, events: [...state.events, `lump_sum:${evt.label ?? 'event'}`] };
  }
  return { ...state, cash: state.cash + evt.amount, events: [...state.events, `lump_sum:${evt.label ?? 'event'}`] };
}

/** Returns the total expense-delta active for the given YYYY-MM, summed across overlapping periods. */
export function monthlyExpenseDeltaFromPeriods(periods: ExpensePeriod[], monthISO: string): number {
  const monthDate = new Date(`${monthISO}-01T00:00:00Z`);
  let delta = 0;
  for (const p of periods) {
    const startDate = new Date(p.start.length === 7 ? `${p.start}-01T00:00:00Z` : `${p.start}T00:00:00Z`);
    const endDate = addMonthsUTC(startDate, p.durationMonths);
    if (monthDate >= startDate && monthDate < endDate) {
      delta += p.monthlyDelta;
    }
  }
  return delta;
}

function addMonthsUTC(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

export interface LoanMonthlyContext {
  loanId: number;
  balance: number;
  annualRate: number;
  regularMonthlyPayment: number;
}

export interface LoanMonthlyResult {
  newBalance: number;
  principalPaid: number;
  interestPaid: number;
  extraApplied: number;
}

export function applyExtraLoanPayment(
  ctx: LoanMonthlyContext,
  extra: ExtraLoanPayment | undefined,
  monthISO: string,
): LoanMonthlyResult {
  if (ctx.balance <= 0) return { newBalance: 0, principalPaid: 0, interestPaid: 0, extraApplied: 0 };

  const monthlyRate = ctx.annualRate / 12;
  const interest = ctx.balance * monthlyRate;
  const regularPrincipal = Math.min(ctx.regularMonthlyPayment - interest, ctx.balance);

  let extraApplied = 0;
  if (extra && extra.extraMonthly > 0 && isWithinWindow(monthISO, extra.start, extra.end)) {
    const balanceAfterRegular = ctx.balance - regularPrincipal;
    extraApplied = Math.min(extra.extraMonthly, balanceAfterRegular);
  }

  const principalPaid = regularPrincipal + extraApplied;
  const newBalance = Math.max(0, ctx.balance - principalPaid);
  return { newBalance, principalPaid, interestPaid: interest, extraApplied };
}

function isWithinWindow(monthISO: string, start?: string, end?: string): boolean {
  const m = monthISO; // 'YYYY-MM'
  if (start && m < start.slice(0, 7)) return false;
  if (end && m > end.slice(0, 7)) return false;
  return true;
}

export function computeMonthlyIncomeForPerson(
  baseSalary: number,
  plan: PersonIncomePlan,
  monthISO: string,         // 'YYYY-MM'
  startYear: number,
): number {
  const [yyyy, mm] = monthISO.split('-').map(Number);

  // Build the per-event timeline applied through monthISO.
  const sortedEvents = [...plan.events].sort((a, b) => a.when.localeCompare(b.when));

  let currentSalary = baseSalary;
  let preSabbaticalSalary = baseSalary;
  let sabbaticalEndISO: string | null = null;
  let sabbaticalResumeAt: number | null = null;

  // Apply raises for each Jan between startYear and monthISO's year, plus any events that have fired.
  let cursorYear = startYear;
  while (cursorYear <= yyyy) {
    if (cursorYear > startYear) {
      currentSalary *= 1 + plan.annualRaiseRate;
    }
    // Apply events that fire in this cursor year, in order
    for (const ev of sortedEvents) {
      const eyy = Number(ev.when.slice(0, 4));
      const emm = Number(ev.when.slice(5, 7));
      if (eyy !== cursorYear) continue;
      if (cursorYear === yyyy && emm > mm) continue; // event still in the future of monthISO
      applyEvent(ev);
    }
    cursorYear++;
  }

  // Check if we're inside a sabbatical at monthISO
  if (sabbaticalEndISO && monthISO < sabbaticalEndISO) {
    return 0;
  }
  if (sabbaticalEndISO && monthISO >= sabbaticalEndISO && sabbaticalResumeAt !== null) {
    currentSalary = sabbaticalResumeAt;
    sabbaticalEndISO = null;
  } else if (sabbaticalEndISO && monthISO >= sabbaticalEndISO) {
    currentSalary = preSabbaticalSalary;
    sabbaticalEndISO = null;
  }

  return currentSalary / 12;

  function applyEvent(ev: IncomeEvent) {
    switch (ev.type) {
      case 'raise':
        currentSalary += ev.deltaAmount;
        break;
      case 'promotion':
      case 'cut':
      case 'job_change':
        currentSalary = ev.newSalary;
        break;
      case 'sabbatical': {
        preSabbaticalSalary = currentSalary;
        const startDate = new Date(`${ev.when}T00:00:00Z`);
        const endDate = new Date(startDate);
        endDate.setUTCMonth(endDate.getUTCMonth() + ev.durationMonths);
        sabbaticalEndISO = endDate.toISOString().slice(0, 7);
        sabbaticalResumeAt = ev.resumesAt ?? null;
        break;
      }
    }
  }
}
