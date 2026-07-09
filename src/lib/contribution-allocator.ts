import type { AssetClass } from '@/types/enums';
import type { AssetClassTarget } from '@/types/schema';
import type { HoldingValuation } from '@/lib/holdings-value';
import { withinClassShares } from '@/lib/allocation-hierarchy';

export interface AllocationInput {
  valuations: HoldingValuation[];
  classTargets: AssetClassTarget[] | null;
  householdTotal: number;
  cash: number;
}

export interface AllocationRow {
  ticker: string;
  assetClass: AssetClass;
  buyDollars: number; // DOLLARS ONLY — no buyShares (H1: per-share price is fictional)
  newPct: number; // ticker's household % AFTER the dollar buy
  targetPct: number | null; // ticker's implied household target (withinClassShare × classTargetPct)
}

export interface AllocationResult {
  rows: AllocationRow[];
  totalAllocated: number;
  cashLeftOver: number; // = cash − Σ buyDollars, EXACT (no rounding residue)
  /** True when ≥1 targeted class OR ticker is overweight (can't be hit without selling). */
  unreachableWithoutSelling: boolean;
  /** Names of the overweight CLASSES, for the primary callout (UX M3). */
  overweightClasses: AssetClass[];
  /**
   * Wave-9: targeted classes with NO held ticker — the allocator has no buy
   * vehicle for them, so their budget stays in cash. Surfaced so the card
   * can explain the leftover instead of rendering a silent $0/empty table.
   */
  unallocatableClasses: { assetClass: AssetClass; need: number }[];
}

/** Distribute `cash` across shortfalls, no-sell, pro-rata to need; full-fund when cash covers all. */
function distribute(needs: Map<string, number>, cash: number): Map<string, number> {
  const out = new Map<string, number>();
  const totalNeed = [...needs.values()].reduce((a, b) => a + b, 0);
  if (totalNeed <= 0 || cash <= 0) return out;
  if (totalNeed <= cash) {
    for (const [k, n] of needs) if (n > 0) out.set(k, n);
    return out;
  }
  for (const [k, n] of needs) if (n > 0) out.set(k, (n / totalNeed) * cash);
  return out;
}

export function allocateContribution(input: AllocationInput): AllocationResult {
  const { valuations, classTargets, householdTotal, cash } = input;
  const postTotal = householdTotal + cash;
  const tmap = new Map<AssetClass, number>();
  for (const t of classTargets ?? []) tmap.set(t.assetClass, t.targetPct);

  // Per-class current value + held tickers. (No share counts — dollars only, H1.)
  const classValue = new Map<AssetClass, number>();
  const tickerValue = new Map<string, number>();
  const tickerClass = new Map<string, AssetClass>();
  for (const v of valuations) {
    classValue.set(v.assetClass, (classValue.get(v.assetClass) ?? 0) + v.value);
    tickerValue.set(v.holding.ticker, (tickerValue.get(v.holding.ticker) ?? 0) + v.value);
    tickerClass.set(v.holding.ticker, v.assetClass);
  }
  const tickersByClass = new Map<AssetClass, string[]>();
  for (const [ticker, cls] of tickerClass) {
    const list = tickersByClass.get(cls) ?? [];
    list.push(ticker);
    tickersByClass.set(cls, list);
  }
  const wcShares = withinClassShares(valuations);

  // ── Layer 1: class need (no-sell) ─────────────────────────────────────────
  let unreachable = false;
  const overweightClasses: AssetClass[] = [];
  const classNeed = new Map<string, number>();
  for (const [cls, targetPct] of tmap) {
    const target$ = targetPct * postTotal;
    const current$ = classValue.get(cls) ?? 0;
    const need = Math.max(0, target$ - current$);
    if (need > 0) classNeed.set(String(cls), need);
    // Overweight (need 0 but current$ already exceeds target$) ⇒ unreachable w/o selling.
    // Capture the class NAME for the primary callout (UX M3).
    if (current$ > target$ + 1e-9) {
      unreachable = true;
      overweightClasses.push(cls);
    }
  }
  // distribute() keys by string; translate back via the same String(cls).
  const classBuyRaw = distribute(classNeed, cash);
  const classBuy = new Map<AssetClass, number>();
  for (const [cls] of tmap) {
    const b = classBuyRaw.get(String(cls));
    if (b && b > 0) classBuy.set(cls, b);
  }

  // ── Within-class TICKER-overweight check (M1) ─────────────────────────────
  // D5 promises "class OR ticker overweight". The class loop above only catches
  // class-level overweight. Scan EVERY targeted ticker (across all targeted
  // classes, regardless of whether the class got a buy): if its current$ exceeds
  // its within-class target$ + ε, the targets can't be hit by buying alone.
  for (const [ticker, share] of wcShares) {
    const cls = tickerClass.get(ticker)!;
    const tTarget$ = share * (postTotal * (tmap.get(cls) ?? 0));
    const tCurrent$ = tickerValue.get(ticker) ?? 0;
    if (tTarget$ > 0 && tCurrent$ > tTarget$ + 1e-9) unreachable = true;
  }

  // ── Layer 2: within-class split (DOLLARS — no share rounding) ─────────────
  const buyDollars = new Map<string, number>();
  const unallocatableClasses: AllocationResult['unallocatableClasses'] = [];
  for (const [cls, budget] of classBuy) {
    const tickers = tickersByClass.get(cls) ?? [];
    if (tickers.length === 0) {
      // Need exists but nothing to buy ⇒ leftover cash. Surface it so the card
      // explains the dead-end instead of a silent $0/empty table.
      unallocatableClasses.push({ assetClass: cls, need: budget });
      continue;
    }
    const anyTargeted = tickers.some((t) => wcShares.has(t));
    if (anyTargeted) {
      // Per-ticker target$ within the class budget, distribute to each ticker's shortfall.
      const needs = new Map<string, number>();
      for (const t of tickers) {
        const share = wcShares.get(t) ?? 0;
        const tTarget$ = share * (postTotal * (tmap.get(cls) ?? 0)); // ticker's household target$
        const tCurrent$ = tickerValue.get(t) ?? 0;
        needs.set(t, Math.max(0, tTarget$ - tCurrent$));
      }
      for (const [t, d] of distribute(needs, budget)) buyDollars.set(t, d);
    } else {
      // No per-ticker targets in this class ⇒ even split (documented fallback).
      const each = budget / tickers.length;
      for (const t of tickers) buyDollars.set(t, each);
    }
  }

  // Build rows in DOLLARS — the per-ticker buyDollars IS the allocation (no
  // share conversion, no Math.floor, no synthetic price). H1.
  const rows: AllocationRow[] = [];
  let totalAllocated = 0;
  for (const [ticker, cls] of tickerClass) {
    const spent = buyDollars.get(ticker) ?? 0;
    const value = tickerValue.get(ticker) ?? 0;
    totalAllocated += spent;
    const newValue = value + spent;
    const newPct = postTotal > 0 ? newValue / postTotal : 0;
    const share = wcShares.get(ticker);
    const targetPct = tmap.has(cls) && share != null ? share * (tmap.get(cls) ?? 0) : null;
    rows.push({ ticker, assetClass: cls, buyDollars: spent, newPct, targetPct });
  }
  rows.sort((a, b) => b.buyDollars - a.buyDollars);

  return {
    rows,
    totalAllocated,
    cashLeftOver: cash - totalAllocated,
    unreachableWithoutSelling: unreachable,
    overweightClasses,
    unallocatableClasses,
  };
}
