import { realRateOfUnfloored } from './calculators/real-rate';

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

export interface FinancialIndependenceScenario {
  label: string;
  rate: number;
}

export interface FinancialIndependenceSeriesResult {
  label: string;
  rate: number;
  years: number;
}

export function financialIndependenceSeries(input: {
  pv: number;
  annualContribution: number;
  targetFv: number;
  scenarios: FinancialIndependenceScenario[];
  /**
   * Optional annual inflation (fraction, e.g. 0.025). When provided, each
   * scenario's NOMINAL rate is converted to a REAL rate via the Fisher
   * equation before the years-to-FI solve, because `targetFv` is expressed in
   * today's dollars (a REAL figure). Omitting it preserves the legacy nominal
   * solve. The returned `rate` is ALWAYS the original nominal rate, so the
   * table display and chart trajectories (which deflate separately) are
   * unaffected. See H1 / `src/lib/calculators/real-rate.ts`.
   */
  inflation?: number;
}): FinancialIndependenceSeriesResult[] {
  return input.scenarios.map((s) => {
    // T17: solve at the UNFLOORED Fisher real rate so the table agrees with the
    // projection chart (which compounds unfloored). A nominal rate at/below
    // inflation yields a negative real rate → the solve returns Infinity, which
    // the FI card renders as "—" (unreachable in real terms). Coast-FI keeps
    // the floored realRateOf for its own framing.
    const solveRate =
      input.inflation === undefined ? s.rate : realRateOfUnfloored(s.rate, input.inflation);
    return {
      label: s.label,
      rate: s.rate,
      years: yearsToFi({
        pv: input.pv,
        pmt: input.annualContribution,
        annualRate: solveRate,
        targetFv: input.targetFv,
      }),
    };
  });
}
