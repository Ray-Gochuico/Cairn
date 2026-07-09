import { describe, it, expect } from 'vitest';
import { AssetClass } from '@/types/enums';
import type { HoldingValuation } from '@/lib/holdings-value';
import type { AssetClassTarget } from '@/types/schema';
import { allocateContribution } from '@/lib/contribution-allocator';

function val(
  ticker: string,
  value: number,
  shareCount: number,
  assetClass: AssetClass,
  target: number | null,
): HoldingValuation {
  return {
    holding: { id: 1, accountId: 1, ticker, shareCount, targetAllocationPct: target, costBasis: null },
    value,
    assetClass,
    accountName: 'A',
  };
}

describe('allocateContribution', () => {
  it('buys the underweight class up toward its target (no-sell, pro-rata) — DOLLARS ONLY', () => {
    // Current: VTI 700 (US_TOTAL_MARKET), BND 300 (US_BONDS); total 1000.
    // Target 50/50. Add 200 ⇒ post-total 1200; class targets 600/600.
    // VTI already 700 (overweight ⇒ 0); BND 300, need 300 but cash 200 ⇒ BND gets $200.
    const vals = [
      val('VTI', 700, 7, AssetClass.US_TOTAL_MARKET, null),
      val('BND', 300, 3, AssetClass.US_BONDS, null),
    ];
    const targets: AssetClassTarget[] = [
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.5 },
    ];
    const r = allocateContribution({ valuations: vals, classTargets: targets, householdTotal: 1000, cash: 200 });
    const bnd = r.rows.find((x) => x.ticker === 'BND')!;
    expect(bnd.buyDollars).toBeCloseTo(200, 5);
    expect('buyShares' in bnd).toBe(false); // DOLLARS ONLY — no synthetic shares column (H1)
    expect(r.rows.find((x) => x.ticker === 'VTI')!.buyDollars).toBeCloseTo(0, 5);
    expect(r.totalAllocated).toBeCloseTo(200, 5);
    expect(r.cashLeftOver).toBeCloseTo(0, 5); // exact, no rounding residue
    expect(r.unreachableWithoutSelling).toBe(true); // VTI overweight vs its 50% target
    expect(r.overweightClasses).toContain(AssetClass.US_TOTAL_MARKET); // named for the callout (M3)
  });

  it('a targeted-but-unheld class is reported, not silently dropped (wave-9 allocator)', () => {
    // US_TOTAL_MARKET holds VTI 10k; US_BONDS is targeted 50% but nothing is
    // held there — the allocator has no buy vehicle, so its budget stays in cash.
    const vals = [val('VTI', 10_000, 10, AssetClass.US_TOTAL_MARKET, null)];
    const targets: AssetClassTarget[] = [
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.5 },
    ];
    const r = allocateContribution({ valuations: vals, classTargets: targets, householdTotal: 10_000, cash: 5_000 });
    expect(r.unallocatableClasses).toEqual([
      expect.objectContaining({ assetClass: AssetClass.US_BONDS }),
    ]);
    expect(r.unallocatableClasses[0].need).toBeGreaterThan(0);
    expect(r.cashLeftOver).toBeGreaterThan(0);
  });

  it('deploys all cash in exact dollars and reports zero leftover when a ticker can absorb it', () => {
    // One class, one ticker, target 100%. Add 250 ⇒ deploy the full $250 (no whole-share floor).
    const vals = [val('VOO', 1000, 10, AssetClass.US_LARGE_CAP, null)];
    const targets: AssetClassTarget[] = [{ assetClass: AssetClass.US_LARGE_CAP, targetPct: 1 }];
    const r = allocateContribution({ valuations: vals, classTargets: targets, householdTotal: 1000, cash: 250 });
    const voo = r.rows.find((x) => x.ticker === 'VOO')!;
    expect(voo.buyDollars).toBeCloseTo(250, 5); // full cash deployed in dollars (was 200 under share-floor)
    expect(r.cashLeftOver).toBeCloseTo(0, 5); // exact — no share rounding strands $50
    expect(r.unreachableWithoutSelling).toBe(false);
    expect(r.overweightClasses).toEqual([]);
  });

  it('splits a class-buy within-class by per-ticker targets', () => {
    // US_TOTAL_MARKET holds VTI (target 0.75 within class) + VXUS (0.25); both currently 0-ish.
    const vals = [
      val('VTI', 10, 1, AssetClass.US_TOTAL_MARKET, 0.75),
      val('VXUS', 10, 1, AssetClass.US_TOTAL_MARKET, 0.25),
    ];
    const targets: AssetClassTarget[] = [{ assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 1 }];
    const r = allocateContribution({ valuations: vals, classTargets: targets, householdTotal: 20, cash: 80 });
    const vti = r.rows.find((x) => x.ticker === 'VTI')!;
    const vxus = r.rows.find((x) => x.ticker === 'VXUS')!;
    // VTI gets ~3× VXUS of the class-buy budget (within-class 0.75 vs 0.25), bounded by shortfalls.
    expect(vti.buyDollars).toBeGreaterThan(vxus.buyDollars);
  });

  it('flags unreachable when a TARGETED TICKER (within class) is overweight (M1)', () => {
    // US_TOTAL_MARKET target 100% so the CLASS is not overweight (class buys are fine),
    // but within the class VTI is targeted 25% yet already holds far more than its
    // within-class target$ ⇒ the within-class layer must set unreachable.
    // VTI 900 + VXUS 100 = class 1000 = household 1000; class target 100% (no class shortfall).
    // within-class shares: VTI .25/(.25+.75)=.25 ; VXUS .75. VTI target$ = .25 × (post 1000+cash).
    // VTI current 900 ≫ its ~250 target$ ⇒ ticker overweight even though class is not.
    const vals = [
      val('VTI', 900, 9, AssetClass.US_TOTAL_MARKET, 0.25),
      val('VXUS', 100, 1, AssetClass.US_TOTAL_MARKET, 0.75),
    ];
    const targets: AssetClassTarget[] = [{ assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 1 }];
    const r = allocateContribution({ valuations: vals, classTargets: targets, householdTotal: 1000, cash: 100 });
    expect(r.unreachableWithoutSelling).toBe(true); // ticker-layer overweight, NOT class-layer
  });

  it('returns all-zero buys + unreachable when everything is overweight', () => {
    const vals = [val('VTI', 1000, 10, AssetClass.US_TOTAL_MARKET, null)];
    const targets: AssetClassTarget[] = [
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.3 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.7 },
    ];
    // No BND held ⇒ BND need exists but no ticker to buy ⇒ leftover cash; VTI overweight.
    const r = allocateContribution({ valuations: vals, classTargets: targets, householdTotal: 1000, cash: 100 });
    expect(r.unreachableWithoutSelling).toBe(true);
    expect(r.overweightClasses).toContain(AssetClass.US_TOTAL_MARKET);
    // US_BONDS has a need but no held ticker ⇒ its cash can't be deployed ⇒ leftover.
    expect(r.cashLeftOver).toBeGreaterThan(0);
  });

  it('handles cash:0 — all-zero buys, zero leftover, no divide-by-zero (M3)', () => {
    const vals = [
      val('VTI', 600, 6, AssetClass.US_TOTAL_MARKET, null),
      val('BND', 400, 4, AssetClass.US_BONDS, null),
    ];
    const targets: AssetClassTarget[] = [
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.5 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.5 },
    ];
    const r = allocateContribution({ valuations: vals, classTargets: targets, householdTotal: 1000, cash: 0 });
    expect(r.totalAllocated).toBeCloseTo(0, 5);
    expect(r.cashLeftOver).toBeCloseTo(0, 5);
    for (const row of r.rows) expect(row.buyDollars).toBeCloseTo(0, 5);
    // VTI 60% > 50% target ⇒ overweight flag is still correct with zero cash.
    expect(r.unreachableWithoutSelling).toBe(true);
    expect(r.overweightClasses).toContain(AssetClass.US_TOTAL_MARKET);
  });
});
