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

export interface ClassTargetRow {
  assetClass: AssetClass;
  actualValue: number;
  actualPct: number; // household basis
  targetPct: number | null; // null = no target for this held class
  targetValue: number | null; // targetPct × householdTotal
  driftPct: number; // actualPct − targetPct (0 when no target)
}

export interface HoldingTargetRow {
  ticker: string;
  assetClass: AssetClass;
  actualValue: number; // aggregated across accounts
  actualPct: number; // household basis
  targetValue: number | null; // withinClassShare × classTarget$ (null if class untargeted)
  driftPct: number; // (actualValue − targetValue)/householdTotal (0 when untargeted)
}

function householdTotalOf(valuations: HoldingValuation[]): number {
  return valuations.reduce((a, v) => a + v.value, 0);
}

function classTargetMap(targets: AssetClassTarget[] | null): Map<AssetClass, number> {
  const m = new Map<AssetClass, number>();
  for (const t of targets ?? []) m.set(t.assetClass, t.targetPct);
  return m;
}

/**
 * Household-level target-vs-actual per asset class (the "By asset class" table).
 *
 * `extraByClass` (optional, Finance M3) adds simulated dollars to a class's
 * actualValue AND to the household total — used by the allocator's "after this
 * contribution" tracking-error stat so post-buy actual %s are measured against
 * the post-buy portfolio (the same (total + cash) basis the allocator targets).
 * Omitted ⇒ identical to the pre-extra behavior.
 */
export function classTargetVsActual(
  valuations: HoldingValuation[],
  targets: AssetClassTarget[] | null,
  extraByClass?: Map<AssetClass, number>,
): ClassTargetRow[] {
  const extra = extraByClass ?? new Map<AssetClass, number>();
  const extraTotal = [...extra.values()].reduce((a, b) => a + b, 0);
  const total = householdTotalOf(valuations) + extraTotal;
  const tmap = classTargetMap(targets);
  const byClass = new Map<AssetClass, number>();
  for (const v of valuations) byClass.set(v.assetClass, (byClass.get(v.assetClass) ?? 0) + v.value);
  // Union of held, targeted, and bumped classes so an over/under-target class
  // with zero current holdings still surfaces.
  const classes = new Set<AssetClass>([...byClass.keys(), ...tmap.keys(), ...extra.keys()]);
  const rows: ClassTargetRow[] = [];
  for (const cls of classes) {
    const actualValue = (byClass.get(cls) ?? 0) + (extra.get(cls) ?? 0);
    const actualPct = total === 0 ? 0 : actualValue / total;
    const targetPct = tmap.has(cls) ? tmap.get(cls)! : null;
    const targetValue = targetPct == null ? null : targetPct * total;
    const driftPct = targetPct == null ? 0 : actualPct - targetPct;
    rows.push({ assetClass: cls, actualValue, actualPct, targetPct, targetValue, driftPct });
  }
  return rows.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}

/** Within-class target-vs-actual per ticker, aggregated across accounts (the "By holding" table). */
export function holdingTargetVsActual(
  valuations: HoldingValuation[],
  targets: AssetClassTarget[] | null,
): HoldingTargetRow[] {
  const total = householdTotalOf(valuations);
  const tmap = classTargetMap(targets);
  const shares = withinClassShares(valuations);
  // Aggregate value + class per ticker.
  const tickerValue = new Map<string, number>();
  const tickerClass = new Map<string, AssetClass>();
  for (const v of valuations) {
    tickerValue.set(v.holding.ticker, (tickerValue.get(v.holding.ticker) ?? 0) + v.value);
    tickerClass.set(v.holding.ticker, v.assetClass);
  }
  const rows: HoldingTargetRow[] = [];
  for (const [ticker, actualValue] of tickerValue.entries()) {
    const cls = tickerClass.get(ticker)!;
    const classTargetPct = tmap.get(cls);
    const share = shares.get(ticker);
    const targetValue =
      classTargetPct != null && share != null ? share * classTargetPct * total : null;
    const actualPct = total === 0 ? 0 : actualValue / total;
    const driftPct = targetValue == null || total === 0 ? 0 : (actualValue - targetValue) / total;
    rows.push({ ticker, assetClass: cls, actualValue, actualPct, targetValue, driftPct });
  }
  return rows.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}
