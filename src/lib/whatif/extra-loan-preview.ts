import { amortize } from '@/lib/amortization';

export interface LoanPreviewInput {
  id: number;
  currentBalance: number;
  interestRate: number;       // 0..1
  monthlyPayment: number;
  termMonths: number;
  firstPaymentDate: string;
}

interface Window { start?: string; end?: string }

interface PreviewResult {
  payoffMonthISO: string;
  baselinePayoffMonthISO: string;
  monthsSaved: number;
  interestSaved: number;
}

export function previewExtraLoanPayment(
  loan: LoanPreviewInput,
  extraMonthly: number,
  window?: Window,
): PreviewResult {
  const baseline = amortize({
    principal: loan.currentBalance,
    annualRatePct: loan.interestRate,
    termMonths: loan.termMonths,
    firstPaymentDate: loan.firstPaymentDate,
    extraPayment: 0,
  });

  if (!window?.start && !window?.end) {
    const accelerated = amortize({
      principal: loan.currentBalance,
      annualRatePct: loan.interestRate,
      termMonths: loan.termMonths,
      firstPaymentDate: loan.firstPaymentDate,
      extraPayment: extraMonthly,
    });
    return {
      baselinePayoffMonthISO: monthOf(baseline.schedule.at(-1)!.paymentDate),
      payoffMonthISO:        monthOf(accelerated.schedule.at(-1)!.paymentDate),
      monthsSaved: baseline.schedule.length - accelerated.schedule.length,
      interestSaved: baseline.totalInterest - accelerated.totalInterest,
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

  return {
    baselinePayoffMonthISO: monthOf(baseline.schedule.at(-1)!.paymentDate),
    payoffMonthISO: sched.at(-1) ?? monthOf(baseline.schedule.at(-1)!.paymentDate),
    monthsSaved: Math.max(0, baseline.schedule.length - sched.length),
    interestSaved: baseline.totalInterest - interestPaid,
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
