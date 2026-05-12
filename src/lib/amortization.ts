export interface AmortizationInput {
  principal: number;
  annualRatePct: number;
  termMonths: number;
  firstPaymentDate: string;   // YYYY-MM-DD
  extraPayment: number;
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
  const monthlyPayment = r === 0
    ? input.principal / n
    : (input.principal * r) / (1 - Math.pow(1 + r, -n));

  let balance = input.principal;
  let totalInterest = 0;
  const schedule: ScheduleEntry[] = [];
  const startDate = new Date(input.firstPaymentDate + 'T00:00:00Z');

  for (let i = 0; balance > 0.005 && i < n + 360 /* safety */; i++) {
    const date = new Date(startDate);
    date.setUTCMonth(date.getUTCMonth() + i);
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
      paymentDate: date.toISOString().slice(0, 10),
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
