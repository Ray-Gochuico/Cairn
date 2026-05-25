import type { MonthlyState } from './engine';
import type { ExpensePeriod, LumpSumEvent } from './lever-types';

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
