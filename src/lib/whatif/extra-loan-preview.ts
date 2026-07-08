import { amortize, scheduleIsCapped } from '@/lib/amortization';

export interface LoanPreviewInput {
  id: number;
  currentBalance: number;
  interestRate: number;       // 0..1
  monthlyPayment: number;
  termMonths: number;
  firstPaymentDate: string;
}

interface Window { start?: string; end?: string }

export interface PreviewResult {
  payoffMonthISO: string;
  baselinePayoffMonthISO: string;
  monthsSaved: number;
  interestSaved: number;
  /**
   * The with-extra projection ran to amortize()'s termMonths+360 safety cap
   * with principal still owing — it never pays off at this payment + extra.
   * payoffMonthISO/monthsSaved/interestSaved describe the CAP, not a payoff;
   * consumers must not present them as one (wave-7 W1, same class as the
   * Wave-6 DebtPayoffCard/Loans guards).
   */
  capped: boolean;
  /**
   * The no-extra BASELINE ran to the cap. Even when the extra rescues the
   * payoff (capped=false), the "was <month> (–N months)" comparison and
   * interestSaved difference against a capped baseline are meaningless.
   */
  baselineCapped: boolean;
}

/** Last schedule month, or '' for an empty (zero-principal) schedule. */
function lastMonthOf(schedule: ReadonlyArray<{ paymentDate: string }>): string {
  return schedule.length > 0 ? monthOf(schedule[schedule.length - 1].paymentDate) : '';
}

export function previewExtraLoanPayment(
  loan: LoanPreviewInput,
  extraMonthly: number,
  window?: Window,
): PreviewResult {
  // Wave-7 W1: both amortize() calls pass the CONTRACT payment. The old
  // calls omitted monthlyPayment, so amortize re-derived a payment that
  // always retires the balance in termMonths (new-loan mode) — a loan whose
  // real payment doesn't cover interest previewed a fake on-schedule payoff
  // (the safety cap could never trip), and the windowed branch compared its
  // contract-payment loop against a derived-payment baseline. Same basis as
  // DebtPayoffCard / the Loans page.
  const baseline = amortize({
    principal: loan.currentBalance,
    annualRatePct: loan.interestRate,
    termMonths: loan.termMonths,
    firstPaymentDate: loan.firstPaymentDate,
    extraPayment: 0,
    monthlyPayment: loan.monthlyPayment,
  });
  const baselineCapped = scheduleIsCapped(baseline.schedule);
  const baselinePayoffMonthISO = lastMonthOf(baseline.schedule);

  if (!window?.start && !window?.end) {
    const accelerated = amortize({
      principal: loan.currentBalance,
      annualRatePct: loan.interestRate,
      termMonths: loan.termMonths,
      firstPaymentDate: loan.firstPaymentDate,
      extraPayment: extraMonthly,
      monthlyPayment: loan.monthlyPayment,
    });
    return {
      baselinePayoffMonthISO,
      payoffMonthISO: lastMonthOf(accelerated.schedule),
      monthsSaved: baseline.schedule.length - accelerated.schedule.length,
      interestSaved: baseline.totalInterest - accelerated.totalInterest,
      capped: scheduleIsCapped(accelerated.schedule),
      baselineCapped,
    };
  }

  let bal = loan.currentBalance;
  const r = loan.interestRate / 12;
  let interestPaid = 0;
  const sched: string[] = [];
  const start = new Date(loan.firstPaymentDate + 'T00:00:00Z');
  for (let i = 0; bal > 0.005 && i < loan.termMonths + 360; i++) {
    const m = new Date(start);
    m.setUTCMonth(m.getUTCMonth() + i);
    const monthISO = m.toISOString().slice(0, 7);
    const interest = bal * r;
    const principal = Math.min(loan.monthlyPayment - interest, bal);
    bal -= principal;
    let extra = 0;
    if (extraMonthly > 0 && isWithinWindow(monthISO, window)) {
      extra = Math.min(extraMonthly, bal);
      bal -= extra;
    }
    interestPaid += interest;
    sched.push(monthISO);
    if (bal <= 0.005) { bal = 0; break; }
  }
  // The loop mirrors amortize()'s termMonths+360 safety cap; exhausting it
  // with principal still owing means the tail month is the CAP, not a payoff
  // (wave-7 W1 — the old code returned it as one).
  const capped = bal > 0.005;

  return {
    baselinePayoffMonthISO,
    payoffMonthISO: sched.length > 0 ? sched[sched.length - 1] : baselinePayoffMonthISO,
    monthsSaved: Math.max(0, baseline.schedule.length - sched.length),
    interestSaved: baseline.totalInterest - interestPaid,
    capped,
    baselineCapped,
  };
}

function isWithinWindow(monthISO: string, win: Window): boolean {
  if (win.start && monthISO < win.start.slice(0, 7)) return false;
  if (win.end   && monthISO > win.end.slice(0, 7))   return false;
  return true;
}

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}
