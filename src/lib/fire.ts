export interface YearsToFiInput {
  pv: number;            // present value (current portfolio)
  pmt: number;           // annual contribution
  annualRate: number;    // 0..1
  targetFv: number;      // target future value (annual_expenses / withdrawal_rate)
}

export function yearsToFi(input: YearsToFiInput): number {
  if (input.targetFv <= input.pv) return 0;
  if (input.pmt === 0 && input.annualRate === 0) return Infinity;
  if (input.annualRate === 0) {
    if (input.pmt <= 0) return Infinity;
    return (input.targetFv - input.pv) / input.pmt;
  }
  const r = input.annualRate;
  // FV = PV(1+r)^t + PMT * ((1+r)^t - 1) / r
  // Solve for t: (1+r)^t * (PV + PMT/r) - PMT/r = FV
  //              (1+r)^t = (FV + PMT/r) / (PV + PMT/r)
  //              t = ln(...) / ln(1+r)
  const numerator = input.targetFv + input.pmt / r;
  const denominator = input.pv + input.pmt / r;
  if (denominator <= 0 || numerator / denominator <= 0) return Infinity;
  const base = 1 + r;
  if (base <= 0) return Infinity;
  const t = Math.log(numerator / denominator) / Math.log(base);
  return Number.isFinite(t) && t > 0 ? t : t === 0 ? 0 : Infinity;
}

export interface FireScenario {
  label: string;
  rate: number;
}

export interface FireSeriesResult {
  label: string;
  rate: number;
  years: number;
}

export function fireSeries(input: {
  pv: number;
  annualContribution: number;
  targetFv: number;
  scenarios: FireScenario[];
}): FireSeriesResult[] {
  return input.scenarios.map((s) => ({
    label: s.label,
    rate: s.rate,
    years: yearsToFi({
      pv: input.pv,
      pmt: input.annualContribution,
      annualRate: s.rate,
      targetFv: input.targetFv,
    }),
  }));
}
