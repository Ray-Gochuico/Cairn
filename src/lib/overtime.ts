import { FilingStatus } from '@/types/enums';

/**
 * Pure overtime math. No I/O, no React. Used by OvertimeCard (Slice 1.6).
 *
 * A line item represents a single overtime "bucket" of hours at a specific
 * base multiplier (e.g., 1.5x) and optional holiday multiplier. Real-world
 * scenarios stack multiple line items: e.g., California daily OT applies the
 * first 4 hours over 8 at 1.5x and any further hours at 2x.
 *
 * Stacking semantics for holiday + base:
 *  - stackMultipliers=true  → effective = base × holiday (multiplicative)
 *  - stackMultipliers=false → effective = max(base, holiday) (whichever is higher)
 */
export interface OvertimeLineItem {
  hours: number;
  /** Base OT multiplier, e.g., 1.5 or 2.0. */
  baseMultiplier: number;
  /** Holiday multiplier; null when the line item is not a holiday. */
  holidayMultiplier: number | null;
  /** When true, holiday multiplies on top of base; otherwise the larger of the two wins. */
  stackMultipliers: boolean;
  /** $/hr added to base rate before the multiplier (FLSA: part of the regular rate). */
  shiftDifferential?: number;
}

export interface OvertimeLineItemResult {
  hours: number;
  effectiveMultiplier: number;
  effectiveBaseRate: number;
  gross: number;
}

export interface OvertimeResult {
  lineItems: OvertimeLineItemResult[];
  totalGross: number;
  totalPremium: number;
}

/** Evaluate a list of OT line items against a base hourly rate. */
export function evaluateOvertimeLineItems(
  items: OvertimeLineItem[],
  baseHourlyRate: number,
): OvertimeResult {
  if (baseHourlyRate <= 0) throw new Error('baseHourlyRate must be positive');
  const lineItems: OvertimeLineItemResult[] = items.map((item) => {
    if (item.hours < 0) throw new Error('hours cannot be negative');
    const effectiveBaseRate = baseHourlyRate + (item.shiftDifferential ?? 0);
    let effectiveMultiplier = item.baseMultiplier;
    if (item.holidayMultiplier !== null) {
      effectiveMultiplier = item.stackMultipliers
        ? item.baseMultiplier * item.holidayMultiplier
        : Math.max(item.baseMultiplier, item.holidayMultiplier);
    }
    const gross = item.hours * effectiveBaseRate * effectiveMultiplier;
    return { hours: item.hours, effectiveMultiplier, effectiveBaseRate, gross };
  });
  const totalGross = lineItems.reduce((sum, r) => sum + r.gross, 0);
  const totalPremium = lineItems.reduce(
    (sum, r) => sum + r.hours * r.effectiveBaseRate * (r.effectiveMultiplier - 1),
    0,
  );
  return { lineItems, totalGross, totalPremium };
}

/** OBBBA (2025-2028) federal deduction for the overtime PREMIUM (pay above the
 *  regular rate), capped at $12,500 (single/HOH/MFS) / $25,000 (MFJ). Estimate:
 *  does NOT model the $150k/$300k MAGI phase-out. */
export function obbbaOvertimeDeduction(premium: number, filingStatus: FilingStatus): number {
  const cap = filingStatus === FilingStatus.MFJ ? 25_000 : 12_500;
  return Math.min(Math.max(0, premium), cap);
}

/**
 * Derives implicit hourly rate for SALARY_WITH_OT persons.
 * Formula: annualSalary / (regularHoursPerWeek × 52).
 */
export function impliedHourlyRate(annualSalary: number, regularHoursPerWeek: number): number {
  if (regularHoursPerWeek <= 0) throw new Error('regularHoursPerWeek must be positive');
  return annualSalary / (regularHoursPerWeek * 52);
}
