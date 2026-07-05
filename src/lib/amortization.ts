export interface AmortizationInput {
  principal: number;
  annualRatePct: number;
  termMonths: number;
  firstPaymentDate: string;   // YYYY-MM-DD
  extraPayment: number;
  /**
   * Contract monthly payment (P&I). When provided and > 0 the schedule uses
   * it verbatim instead of re-deriving a payment from principal/termMonths —
   * the correct way to project the REMAINDER of a seasoned loan from its
   * current balance (re-deriving spreads the balance over the full term
   * again, understating the payment and overstating remaining interest).
   * `termMonths` remains only a safety cap on schedule length. Omit, or pass
   * 0/undefined, to derive the payment (new-loan mode; 0 covers loans whose
   * stored monthlyPayment was never entered).
   */
  monthlyPayment?: number;
}

export interface ScheduleEntry {
  paymentDate: string;
  principal: number;
  interest: number;
  extra: number;
  balance: number;
}

export interface Amortization {
  monthlyPayment: number;
  totalInterest: number;
  schedule: ScheduleEntry[];
}

export function amortize(input: AmortizationInput): Amortization {
  if (input.principal < 0) throw new Error('principal must be non-negative');
  if (input.termMonths <= 0) throw new Error('termMonths must be positive');
  if (input.annualRatePct < 0 || input.annualRatePct > 1) {
    throw new Error('annualRatePct must be 0..1 (e.g. 0.06 for 6%)');
  }

  const r = input.annualRatePct / 12;
  const n = input.termMonths;
  const derivedPayment = r === 0
    ? input.principal / n
    : (input.principal * r) / (1 - Math.pow(1 + r, -n));
  const monthlyPayment =
    input.monthlyPayment != null && input.monthlyPayment > 0
      ? input.monthlyPayment
      : derivedPayment;

  let balance = input.principal;
  let totalInterest = 0;
  const schedule: ScheduleEntry[] = [];
  const startDate = new Date(input.firstPaymentDate + 'T00:00:00Z');

  const startYear = startDate.getUTCFullYear();
  const startMonth = startDate.getUTCMonth();
  const startDay = startDate.getUTCDate();

  for (let i = 0; balance > 0.005 && i < n + 360 /* safety cap: also bounds a below-interest contract payment (negative amortization never pays off) */; i++) {
    const date = paymentDateAt(startYear, startMonth, startDay, i);
    const interest = balance * r;
    let principal = monthlyPayment - interest;
    let extra = input.extraPayment;
    if (principal + extra > balance) {
      principal = balance - extra;
      if (principal < 0) { extra += principal; principal = 0; }
    }
    balance -= principal + extra;
    totalInterest += interest;
    schedule.push({
      paymentDate: date,
      principal: round2(principal),
      interest: round2(interest),
      extra: round2(extra),
      balance: round2(Math.max(0, balance)),
    });
  }

  return {
    monthlyPayment: round2(monthlyPayment),
    totalInterest: round2(totalInterest),
    schedule,
  };
}

/**
 * The i-th monthly payment date from a start Y/M/D, with the day-of-month
 * clamped to the target month's length (Jan-31 start → Feb-28/29, not Mar-2).
 * UTC throughout. Shared by amortize()'s schedule loop and
 * nextPaymentDateFrom() so the anchor and the schedule can never disagree.
 */
function paymentDateAt(startYear: number, startMonth: number, startDay: number, i: number): string {
  const lastDay = new Date(Date.UTC(startYear, startMonth + i + 1, 0)).getUTCDate();
  return new Date(Date.UTC(startYear, startMonth + i, Math.min(startDay, lastDay)))
    .toISOString()
    .slice(0, 10);
}

/**
 * First scheduled payment date on-or-after `todayISO`, stepping monthly from
 * `firstPaymentDate` with the same day-of-month clamping as the schedule.
 * A future firstPaymentDate returns itself. Today counting as "next" (>=,
 * not >) keeps a payment due today inside the remaining schedule.
 *
 * Use this to anchor a remaining-schedule amortize() call: passing the
 * ORIGINAL firstPaymentDate would date the projected payments years in the
 * past.
 */
export function nextPaymentDateFrom(firstPaymentDate: string, todayISO: string): string {
  if (firstPaymentDate >= todayISO) return firstPaymentDate;
  const start = new Date(firstPaymentDate + 'T00:00:00Z');
  const today = new Date(todayISO + 'T00:00:00Z');
  const startYear = start.getUTCFullYear();
  const startMonth = start.getUTCMonth();
  const startDay = start.getUTCDate();
  let k =
    (today.getUTCFullYear() - startYear) * 12 +
    (today.getUTCMonth() - startMonth);
  if (paymentDateAt(startYear, startMonth, startDay, k) < todayISO) k += 1;
  return paymentDateAt(startYear, startMonth, startDay, k);
}

/**
 * True when `schedule` ended at amortize()'s safety cap with principal still
 * owing — i.e. the contract payment doesn't amortize the balance within
 * termMonths + 360 months. The classic cause is a payment at or below the
 * monthly interest (negative amortization: the balance grows forever); a
 * technically-amortizing payment that would need longer than the cap trips
 * this too. Either way the schedule's tail figures (last paymentDate,
 * accumulated totalInterest) describe the CAP, not a payoff, and callers
 * must not present them as one (round-2 finding A1).
 *
 * Detection is by residual balance on the final row (> half a cent, the
 * loop's own `balance > 0.005` continue condition) rather than by row
 * count, so it works on any schedule the caller holds and never
 * false-positives on a loan that pays off exactly at the cap length.
 * An empty schedule (zero principal) is not capped.
 */
export function scheduleIsCapped(schedule: ReadonlyArray<ScheduleEntry>): boolean {
  if (schedule.length === 0) return false;
  return schedule[schedule.length - 1].balance > 0.005;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
