import type { MonthlyState } from './engine';
import type { LumpSumEvent } from './lever-types';

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
