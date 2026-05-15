export type CompoundFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

const PERIODS_PER_YEAR: Record<CompoundFrequency, number> = {
  DAILY: 365,
  WEEKLY: 52,
  MONTHLY: 12,
  QUARTERLY: 4,
  ANNUALLY: 1,
};

export interface CompoundInterestInput {
  pv: number;
  monthlyContribution: number;
  annualRate: number;       // decimal: 0.07 = 7%
  varianceRate?: number;    // decimal: 0.02 = ±2%
  years: number;            // integer
  frequency: CompoundFrequency;
}

export interface CompoundInterestSeries {
  yearly: Array<{ year: number; low: number; mid: number; high: number }>;
  totalContributed: number;
  totalInterestMid: number;
  finalLow: number;
  finalMid: number;
  finalHigh: number;
}

function fvAt(pv: number, pmtPerPeriod: number, r: number, n: number): number {
  if (r === 0) return pv + pmtPerPeriod * n;
  const growth = Math.pow(1 + r, n);
  return pv * growth + pmtPerPeriod * (growth - 1) / r;
}

export function compoundInterestSeries(input: CompoundInterestInput): CompoundInterestSeries {
  const ppy = PERIODS_PER_YEAR[input.frequency];
  // "monthlyContribution" is the user's mental model regardless of compounding.
  // Distribute it evenly across the chosen period.
  const pmtPerPeriod = (input.monthlyContribution * 12) / ppy;
  const variance = input.varianceRate ?? 0;

  const yearly: CompoundInterestSeries['yearly'] = [];
  for (let year = 1; year <= input.years; year++) {
    const n = year * ppy;
    const low = fvAt(input.pv, pmtPerPeriod, (input.annualRate - variance) / ppy, n);
    const mid = fvAt(input.pv, pmtPerPeriod, input.annualRate / ppy, n);
    const high = fvAt(input.pv, pmtPerPeriod, (input.annualRate + variance) / ppy, n);
    yearly.push({ year, low, mid, high });
  }

  const last = yearly[yearly.length - 1] ?? { low: input.pv, mid: input.pv, high: input.pv };
  const totalContributed = input.pv + input.monthlyContribution * 12 * input.years;
  const totalInterestMid = last.mid - totalContributed;

  return {
    yearly,
    totalContributed,
    totalInterestMid,
    finalLow: last.low,
    finalMid: last.mid,
    finalHigh: last.high,
  };
}
