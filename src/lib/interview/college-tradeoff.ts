/**
 * Pure money-math for the college_vs_retirement thread. EVERYTHING here is
 * REAL (today's dollars): the tuition growth rate comes from
 * tuition-reference.ts (basis 'real' by type contract) and the 529 leg
 * deflates the nominal scenario rate via Fisher DIVISION — never
 * subtraction, never a raw nominal compound (the repo's 3×-shipped
 * nominal-on-real bug class; see the HISTORICAL ANCHOR test).
 * No imports from domain/, no Date, no I/O.
 */

export interface CollegeTargetInput {
  /** Sticker tuition+fees + housing/food, $/yr, today's dollars. */
  annualTodayDollars: number;
  /** % per year ABOVE inflation (REAL) — dataset units, e.g. 2 = 2%/yr. */
  realGrowthPctPerYear: number;
  /** Whole months until the first college year begins; >= 0. */
  startMonthsAhead: number;
  /** College years to fund (default 4). */
  collegeYears?: number;
}

/** D-T3-12: each of the four years is grown to ITS year — Σ annual×(1+r)^(y+k). */
export function computeCollegeTarget(i: CollegeTargetInput): number {
  const r = i.realGrowthPctPerYear / 100;
  const years = i.startMonthsAhead / 12;
  const n = i.collegeYears ?? 4;
  let total = 0;
  for (let k = 0; k < n; k += 1) {
    total += i.annualTodayDollars * Math.pow(1 + r, years + k);
  }
  return total;
}

export interface College529Input {
  balanceTodayDollars: number;
  monthlyDollars: number;
  /** Whole months of contribution + growth. */
  months: number;
  /** Nominal annual scenario rate as a FRACTION (household units, e.g. 0.06). */
  nominalAnnualRate: number;
  /** Annual inflation as a FRACTION (household.inflationAssumption). */
  annualInflation: number;
}

/** Future value in TODAY'S dollars: Fisher real rate, monthly compounding. */
export function project529Real(i: College529Input): number {
  const realAnnual = (1 + i.nominalAnnualRate) / (1 + i.annualInflation) - 1;
  const m = Math.pow(1 + realAnnual, 1 / 12) - 1;
  if (m === 0) return i.balanceTodayDollars + i.monthlyDollars * i.months;
  const growth = Math.pow(1 + m, i.months);
  return i.balanceTodayDollars * growth + (i.monthlyDollars * (growth - 1)) / m;
}
