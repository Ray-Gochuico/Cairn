import type { AssetClass } from '@/types/enums';
import type { AssetClassTarget } from '@/types/schema';
import type { HoldingValuation } from '@/lib/holdings-value';

export type ClassTargetValidation =
  | { ok: true }
  | { ok: false; sum: number; message: string };

/** Household class targets must sum to ≤ 100%. null = no targets (ok). */
export function validateClassTargets(
  targets: AssetClassTarget[] | null,
): ClassTargetValidation {
  if (targets === null) return { ok: true };
  const sum = targets.reduce((a, t) => a + t.targetPct, 0);
  if (sum <= 1 + 1e-9) return { ok: true };
  return {
    ok: false,
    sum,
    message: `Asset-class targets sum to ${(sum * 100).toFixed(1)}% (cap: 100%).`,
  };
}

/**
 * Derive each ticker's WITHIN-CLASS share from the stored per-ticker targets.
 * For each asset class, normalize the target_allocation_pct of the held
 * tickers that HAVE a target so they sum to 1.0 within that class. Tickers in
 * a class where no ticker has a target are omitted (the allocator falls back
 * to an even split for such classes). Aggregates a ticker held in multiple
 * accounts by summing its targets (a single household-level within-class
 * intent; accounts are a storage detail at this layer).
 */
export function withinClassShares(
  valuations: HoldingValuation[],
): Map<string, number> {
  // ticker -> summed stored target (across accounts), and ticker -> class
  const tickerTarget = new Map<string, number>();
  const tickerClass = new Map<string, AssetClass>();
  for (const v of valuations) {
    tickerClass.set(v.holding.ticker, v.assetClass);
    const t = v.holding.targetAllocationPct;
    if (t != null) {
      tickerTarget.set(v.holding.ticker, (tickerTarget.get(v.holding.ticker) ?? 0) + t);
    }
  }
  // Sum of targets per class (only tickers that have a target contribute).
  const classSum = new Map<AssetClass, number>();
  for (const [ticker, t] of tickerTarget.entries()) {
    const cls = tickerClass.get(ticker)!;
    classSum.set(cls, (classSum.get(cls) ?? 0) + t);
  }
  const shares = new Map<string, number>();
  for (const [ticker, t] of tickerTarget.entries()) {
    const cls = tickerClass.get(ticker)!;
    const denom = classSum.get(cls) ?? 0;
    if (denom > 0) shares.set(ticker, t / denom);
  }
  return shares;
}
