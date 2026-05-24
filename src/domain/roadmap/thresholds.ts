/**
 * Debt-rate classification thresholds for the Roadmap rule engine.
 *
 * Values are in *percent* (so 5 means 5%, not 0.05). The original
 * community chart used "prime rate" as a sliding reference; this app
 * uses fixed numbers for predictability. The user can override per
 * household via Settings → Advanced (Sub-Plan D).
 */
export const INTEREST_THRESHOLDS = {
  low: 5,   // < 5%  → low-interest debt
  high: 8,  // ≥ 8% → high-interest debt
  // 5%–<8% falls in the moderate band.
} as const;

export interface ResolvedThresholds {
  low: number;
  high: number;
}

/**
 * Pull the user's per-household threshold overrides (if any), falling
 * back to INTEREST_THRESHOLDS. Caller is expected to pass the
 * household's chart-answer cache columns directly.
 */
export function getInterestThresholds(household: {
  interestThresholdLowPct: number | null;
  interestThresholdHighPct: number | null;
}): ResolvedThresholds {
  return {
    low:  household.interestThresholdLowPct  ?? INTEREST_THRESHOLDS.low,
    high: household.interestThresholdHighPct ?? INTEREST_THRESHOLDS.high,
  };
}

export type DebtClass = 'low' | 'moderate' | 'high';

/**
 * Classify an annual interest rate (percent) against the resolved
 * thresholds. Boundary behaviour: the low threshold is the *floor* of
 * moderate (≥ low → at least moderate); the high threshold is the
 * *floor* of high (≥ high → high). So with default 5/8:
 *   4.99% → low
 *   5.00% → moderate
 *   7.99% → moderate
 *   8.00% → high
 */
export function classifyDebtRate(
  annualRatePct: number,
  thresholds: ResolvedThresholds,
): DebtClass {
  if (annualRatePct >= thresholds.high) return 'high';
  if (annualRatePct >= thresholds.low) return 'moderate';
  return 'low';
}
