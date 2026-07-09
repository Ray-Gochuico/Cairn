export type CompoundFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

/**
 * Convert an APY (effective annual yield after compounding) into the nominal
 * APR that, compounded `ppy` times/year, reproduces it:
 *   APY = (1 + APR/ppy)^ppy − 1  ⇒  APR = ppy · ((1 + APY)^(1/ppy) − 1).
 * Moved out of CompoundInterestCard (Wave 2) so the conversion is shared + tested.
 */
export function apyToApr(apy: number, ppy: number): number {
  if (apy === 0) return 0;
  if (ppy === 1) return apy; // annual: APY == APR
  return ppy * (Math.pow(1 + apy, 1 / ppy) - 1);
}

export const PERIODS_PER_YEAR: Record<CompoundFrequency, number> = {
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

/** All figures a Real-mode CompoundInterest card displays, in today's dollars. */
export interface RealSummary {
  finalLow: number;
  finalMid: number;
  finalHigh: number;
  totalContributed: number;
  totalInterestMid: number;
}

/**
 * Deflate a nominal {@link CompoundInterestSeries} to today's dollars for the
 * whole card (headline + all three stat tiles), so a Real-mode card never
 * shows a real chart next to nominal tiles (the nominal-on-real bug class this
 * app has shipped before). Two DIFFERENT deflators, on purpose:
 *
 *  - Final balances deflate by the HORIZON deflator `(1+i)^years` — they are a
 *    single lump sum landing at the end of the projection.
 *  - Total contributed deflates EACH period's contribution by ITS OWN elapsed
 *    time (`(1+i)^(p/ppy)`), mirroring compoundInterestSeries exactly. Deflating
 *    the whole contributed sum by the horizon deflator would understate
 *    contributions and overstate interest — the precise mistake to avoid.
 *
 * `totalInterestMid` is derived as `finalMid − totalContributed` so the
 * identity `finalMid = totalContributed + totalInterestMid` can never drift.
 * Zero inflation returns the nominal summary unchanged.
 */
export function toRealSummary(
  input: CompoundInterestInput,
  series: CompoundInterestSeries,
  annualInflation: number,
): RealSummary {
  if (annualInflation === 0) {
    return {
      finalLow: series.finalLow,
      finalMid: series.finalMid,
      finalHigh: series.finalHigh,
      totalContributed: series.totalContributed,
      totalInterestMid: series.totalInterestMid,
    };
  }

  const horizonDeflator = Math.pow(1 + annualInflation, input.years);
  const finalLow = series.finalLow / horizonDeflator;
  const finalMid = series.finalMid / horizonDeflator;
  const finalHigh = series.finalHigh / horizonDeflator;

  const ppy = PERIODS_PER_YEAR[input.frequency];
  const pmtPerPeriod = (input.monthlyContribution * 12) / ppy;
  let totalContributed = input.pv;
  for (let p = 1; p <= input.years * ppy; p++) {
    totalContributed += pmtPerPeriod / Math.pow(1 + annualInflation, p / ppy);
  }

  const totalInterestMid = finalMid - totalContributed;
  return { finalLow, finalMid, finalHigh, totalContributed, totalInterestMid };
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
