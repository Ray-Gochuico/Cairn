import { describe, it, expect } from 'vitest';
import { AssetClass } from '@/types/enums';
import type { HoldingValuation } from '@/lib/holdings-value';
import { validateClassTargets, withinClassShares } from '@/lib/allocation-hierarchy';

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
