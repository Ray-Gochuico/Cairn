import { describe, it, expect } from 'vitest';
import { AssetClass } from '@/types/enums';
import type { HoldingValuation } from '@/lib/holdings-value';
import type { AssetClassTarget } from '@/types/schema';
import {
  validateClassTargets,
  withinClassShares,
  classTargetVsActual,
  holdingTargetVsActual,
} from '@/lib/allocation-hierarchy';

function val(
  ticker: string,
  value: number,
  assetClass: AssetClass,
  targetAllocationPct: number | null,
): HoldingValuation {
  return {
    holding: { id: 1, accountId: 1, ticker, shareCount: value || 1, targetAllocationPct, costBasis: null },
    value,
    assetClass,
    accountName: 'Acct',
  };
}

describe('validateClassTargets', () => {
  it('accepts a sum ≤ 1', () => {
    expect(
      validateClassTargets([
        { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.6 },
        { assetClass: AssetClass.US_BONDS, targetPct: 0.4 },
      ]).ok,
    ).toBe(true);
  });
  it('rejects a sum > 1 with the over-amount', () => {
    const r = validateClassTargets([
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.8 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.4 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sum).toBeCloseTo(1.2, 5);
  });
  it('treats null as no-targets (ok)', () => {
    expect(validateClassTargets(null).ok).toBe(true);
  });
});

describe('withinClassShares', () => {
  it('normalizes per-ticker targets within a class to sum to 1', () => {
    const vals = [
      val('VTI', 100, AssetClass.US_TOTAL_MARKET, 0.3),
      val('VXUS', 100, AssetClass.US_TOTAL_MARKET, 0.1),
      val('BND', 100, AssetClass.US_BONDS, 0.5),
    ];
    const shares = withinClassShares(vals);
    // VTI 0.3 / (0.3+0.1) = 0.75 ; VXUS 0.25 within US_TOTAL_MARKET
    expect(shares.get('VTI')).toBeCloseTo(0.75, 5);
    expect(shares.get('VXUS')).toBeCloseTo(0.25, 5);
    // BND alone in US_BONDS ⇒ 1.0
    expect(shares.get('BND')).toBeCloseTo(1, 5);
  });
  it('omits tickers whose class has no targeted ticker', () => {
    const vals = [val('AAA', 50, AssetClass.CRYPTO, null)];
    expect(withinClassShares(vals).has('AAA')).toBe(false);
  });
});

describe('classTargetVsActual', () => {
  it('computes household-basis target$/actual$/drift per class', () => {
    const vals = [
      val('VTI', 600, AssetClass.US_TOTAL_MARKET, null),
      val('BND', 400, AssetClass.US_BONDS, null),
    ]; // householdTotal = 1000
    const targets: AssetClassTarget[] = [
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.5 },
    ];
    const rows = classTargetVsActual(vals, targets);
    const eq = rows.find((r) => r.assetClass === AssetClass.US_TOTAL_MARKET)!;
    expect(eq.actualValue).toBeCloseTo(600, 5);
    expect(eq.targetValue).toBeCloseTo(500, 5); // 0.5 × 1000
    expect(eq.driftPct).toBeCloseTo(0.1, 5); // 0.6 − 0.5
    // sorted by |driftPct| desc
    expect(Math.abs(rows[0].driftPct)).toBeGreaterThanOrEqual(Math.abs(rows[1].driftPct));
  });

  it('applies extraByClass to actualValue AND the household total (Finance M3 — drift-after)', () => {
    const vals = [
      val('VTI', 600, AssetClass.US_TOTAL_MARKET, null),
      val('BND', 400, AssetClass.US_BONDS, null),
    ]; // householdTotal = 1000; 60/40 vs 50/50 targets ⇒ BND underweight by 0.1
    const targets: AssetClassTarget[] = [
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.5 },
    ];
    const base = classTargetVsActual(vals, targets);
    // Buy $200 of BONDS ⇒ new total 1200, BONDS 600/1200 = 50% ⇒ |drift| shrinks to ~0.
    const extra = new Map([[AssetClass.US_BONDS, 200]]);
    const after = classTargetVsActual(vals, targets, extra);
    const bondsBase = base.find((r) => r.assetClass === AssetClass.US_BONDS)!;
    const bondsAfter = after.find((r) => r.assetClass === AssetClass.US_BONDS)!;
    expect(Math.abs(bondsAfter.driftPct)).toBeLessThan(Math.abs(bondsBase.driftPct));
    expect(bondsAfter.actualValue).toBeCloseTo(600, 5); // 400 + 200
    expect(bondsAfter.actualPct).toBeCloseTo(0.5, 5); // measured against 1200
  });
});

describe('holdingTargetVsActual', () => {
  it('aggregates a ticker across accounts and scales ticker target into household $', () => {
    const vals = [
      { ...val('VTI', 300, AssetClass.US_TOTAL_MARKET, 0.5), accountName: 'A' },
      { ...val('VTI', 300, AssetClass.US_TOTAL_MARKET, 0.5), accountName: 'B' },
      { ...val('VXUS', 100, AssetClass.US_TOTAL_MARKET, 0.5), accountName: 'A' },
      { ...val('BND', 300, AssetClass.US_BONDS, null), accountName: 'A' },
    ]; // householdTotal = 1000 ; US_TOTAL_MARKET value = 700
    const targets: AssetClassTarget[] = [
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.7 },
    ];
    const rows = holdingTargetVsActual(vals, targets);
    const vti = rows.find((r) => r.ticker === 'VTI')!;
    // VTI aggregated value = 600 across A+B
    expect(vti.actualValue).toBeCloseTo(600, 5);
    // withinClassShares SUMS a ticker's per-account targets (documented
    // aggregation): VTI = 0.5(A)+0.5(B) = 1.0, VXUS = 0.5 ⇒ class sum 1.5.
    // within-class share VTI = 1.0/1.5 = 0.6667 ; classTarget$ = 0.7×1000=700 ;
    // target$ = 0.6667 × 700 ≈ 466.67.
    expect(vti.targetValue).toBeCloseTo((1 / 1.5) * 0.7 * 1000, 5);
    // BND has no class target ⇒ targetValue null
    const bnd = rows.find((r) => r.ticker === 'BND')!;
    expect(bnd.targetValue).toBeNull();
  });
});
