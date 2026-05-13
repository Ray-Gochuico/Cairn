import { CONTRIBUTION_LIMITS_2026 } from './contribution-limits';

export interface Bracket {
  min: number;       // inclusive lower bound
  max: number | null; // exclusive upper bound; null = unbounded
  rate: number;      // 0..1
}

export function evaluateBrackets(brackets: Bracket[], taxableIncome: number): number {
  if (taxableIncome < 0) throw new Error('taxableIncome must be non-negative');
  if (taxableIncome === 0) return 0;

  let tax = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    const top = b.max === null ? taxableIncome : Math.min(b.max, taxableIncome);
    tax += (top - b.min) * b.rate;
    if (b.max === null || taxableIncome <= b.max) break;
  }
  return tax;
}

const ADDITIONAL_MEDICARE_THRESHOLD = {
  SINGLE: 200000,
  HOH: 200000,
  MFS: 125000,
  MFJ: 250000,
} as const;

export function computeFica(gross: number, filingStatus: keyof typeof ADDITIONAL_MEDICARE_THRESHOLD): number {
  if (gross < 0) throw new Error('gross must be non-negative');
  const ssBase = Math.min(gross, CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE);
  const ss = ssBase * 0.062;
  const medicareBase = gross * 0.0145;
  const threshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus];
  const additionalMedicare = gross > threshold ? (gross - threshold) * 0.009 : 0;
  return ss + medicareBase + additionalMedicare;
}
