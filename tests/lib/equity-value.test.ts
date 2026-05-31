import { describe, it, expect } from 'vitest';
import { computeEquityValue, computeFmvFromCompanyValuation, vestingChartData, grantOrdinaryIncomeOnVest, isIsoAmtPreference } from '@/lib/equity-value';
import { GrantType } from '@/types/enums';

const grant = {
  grantDate: '2024-01-15',
  strikePrice: 5,
  totalShares: 1000,
  currentFmv: 50,
  vestingSchedule: [
    { date: '2025-01-15', cumulativePct: 0.25 },
    { date: '2026-01-15', cumulativePct: 0.50 },
    { date: '2027-01-15', cumulativePct: 0.75 },
    { date: '2028-01-15', cumulativePct: 1.00 },
  ],
};

describe('computeEquityValue', () => {
  it('returns 0 vested before cliff', () => {
    const result = computeEquityValue(grant, new Date('2024-06-01'));
    expect(result.vestedShares).toBe(0);
    expect(result.vestedValue).toBe(0);
  });

  it('returns 25% vested after first cliff', () => {
    const result = computeEquityValue(grant, new Date('2025-06-01'));
    expect(result.vestedShares).toBe(250);
    expect(result.vestedValue).toBe(250 * 50);
    expect(result.unvestedShares).toBe(750);
  });

  it('returns 100% vested after final entry', () => {
    const result = computeEquityValue(grant, new Date('2029-01-01'));
    expect(result.vestedShares).toBe(1000);
    expect(result.unvestedShares).toBe(0);
  });

  it('upcoming vest dates lists next 3 future entries', () => {
    const result = computeEquityValue(grant, new Date('2025-06-01'));
    expect(result.upcomingVestDates).toEqual(['2026-01-15', '2027-01-15', '2028-01-15']);
  });

  it('monthlyCost amortizes total strike cost over vesting duration', () => {
    // total strike = 5 * 1000 = 5000; vesting duration = 48 months
    const result = computeEquityValue(grant, new Date('2025-06-01'));
    expect(result.monthlyCost).toBeCloseTo(5000 / 48, 2);
  });

  // Bonus tests
  it('strike price = 0 (RSU) yields monthlyCost = 0', () => {
    const rsuGrant = { ...grant, strikePrice: 0 };
    const result = computeEquityValue(rsuGrant, new Date('2025-06-01'));
    expect(result.monthlyCost).toBe(0);
  });

  it('single-entry schedule (immediate full vest at grant date) clamps duration to 1 month', () => {
    const immediateGrant = {
      grantDate: '2024-01-15',
      strikePrice: 10,
      totalShares: 100,
      currentFmv: 25,
      vestingSchedule: [{ date: '2024-01-15', cumulativePct: 1.0 }],
    };
    const result = computeEquityValue(immediateGrant, new Date('2024-06-01'));
    // duration = max(1, 0 months) = 1; monthlyCost = 10 * 100 / 1 = 1000
    expect(result.monthlyCost).toBe(1000);
    expect(result.vestedShares).toBe(100);
    expect(result.unvestedShares).toBe(0);
  });

  it('today exactly on a vest date counts that entry (<= condition)', () => {
    // 2025-01-15 is exactly the first vest date; pct should be 0.25
    const result = computeEquityValue(grant, new Date('2025-01-15T12:00:00Z'));
    expect(result.vestedShares).toBe(250);
  });

  it('upcomingVestDates is empty array when fully vested', () => {
    const result = computeEquityValue(grant, new Date('2029-01-01'));
    expect(result.upcomingVestDates).toEqual([]);
  });

  it('currentFmv = 0 yields vestedValue = 0 regardless of shares', () => {
    const zeroFmvGrant = { ...grant, currentFmv: 0 };
    const result = computeEquityValue(zeroFmvGrant, new Date('2025-06-01'));
    expect(result.vestedValue).toBe(0);
    expect(result.unvestedValue).toBe(0);
    // shares still vest correctly
    expect(result.vestedShares).toBe(250);
    expect(result.unvestedShares).toBe(750);
  });
});

describe('computeFmvFromCompanyValuation', () => {
  it('returns (val − debt) / shares when all inputs valid', () => {
    expect(computeFmvFromCompanyValuation(10_000_000, 2_000_000, 5_000_000)).toEqual({
      value: 1.6,
      warning: null,
    });
  });

  it('handles zero debt', () => {
    expect(computeFmvFromCompanyValuation(10_000_000, 0, 5_000_000)).toEqual({
      value: 2.0,
      warning: null,
    });
  });

  it('returns null when companyValuation is null', () => {
    expect(computeFmvFromCompanyValuation(null, 0, 1000)).toBeNull();
  });

  it('returns null when totalDebt is null', () => {
    expect(computeFmvFromCompanyValuation(1000, null, 100)).toBeNull();
  });

  it('returns null when outstandingShares is null', () => {
    expect(computeFmvFromCompanyValuation(1000, 0, null)).toBeNull();
  });

  it('returns null when outstandingShares is 0', () => {
    expect(computeFmvFromCompanyValuation(1000, 0, 0)).toBeNull();
  });

  it('returns null when outstandingShares is negative', () => {
    expect(computeFmvFromCompanyValuation(1000, 0, -1)).toBeNull();
  });

  it('clamps to 0 and flags OVER_LEVERAGED when debt > valuation', () => {
    expect(computeFmvFromCompanyValuation(5_000_000, 6_000_000, 1_000_000)).toEqual({
      value: 0,
      warning: 'OVER_LEVERAGED',
    });
  });

  it('returns 0 with NO warning when debt EQUALS valuation', () => {
    expect(computeFmvFromCompanyValuation(5_000_000, 5_000_000, 1_000_000)).toEqual({
      value: 0,
      warning: null,
    });
  });

  it('returns 0 when valuation is 0 and debt is 0', () => {
    expect(computeFmvFromCompanyValuation(0, 0, 100)).toEqual({
      value: 0,
      warning: null,
    });
  });
});

describe('vestingChartData', () => {
  it('builds a monotonic cumulative-vested-$ timeline across grants', () => {
    // Grant A: 1000 shares @ $10 FMV, vests 50% on 2025-01-01, 100% on 2026-01-01
    // Grant B: 500 shares @ $20 FMV, vests 100% on 2025-01-01
    //
    // Union dates: ['2025-01-01', '2026-01-01']
    // At 2025-01-01: (0.5 × 1000 × 10) + (1.0 × 500 × 20) = 5000 + 10000 = 15000
    // At 2026-01-01: (1.0 × 1000 × 10) + (1.0 × 500 × 20) = 10000 + 10000 = 20000
    // Σ shares×fmv = 1000×10 + 500×20 = 20000
    const grantA = {
      grantDate: '2024-01-01',
      strikePrice: 0,
      totalShares: 1000,
      currentFmv: 10,
      vestingSchedule: [
        { date: '2025-01-01', cumulativePct: 0.5 },
        { date: '2026-01-01', cumulativePct: 1.0 },
      ],
    };
    const grantB = {
      grantDate: '2024-01-01',
      strikePrice: 0,
      totalShares: 500,
      currentFmv: 20,
      vestingSchedule: [
        { date: '2025-01-01', cumulativePct: 1.0 },
      ],
    };

    const pts = vestingChartData([grantA, grantB]);

    // One point per distinct vest date (sorted union)
    expect(pts.map((p) => p.date)).toEqual(['2025-01-01', '2026-01-01']);

    // Cumulative, non-decreasing
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].vestedValue).toBeGreaterThanOrEqual(pts[i - 1].vestedValue);
    }

    // Spot-check values
    expect(pts[0].vestedValue).toBeCloseTo(15000);
    expect(pts[1].vestedValue).toBeCloseTo(20000);

    // Final point ≈ Σ shares×fmv (fully vested)
    expect(pts.at(-1)!.vestedValue).toBeCloseTo(20000);
  });

  it('returns empty array for empty grants list', () => {
    expect(vestingChartData([])).toEqual([]);
  });

  it('returns single point for a single-entry vesting schedule', () => {
    const singleVest = {
      grantDate: '2024-01-01',
      strikePrice: 0,
      totalShares: 100,
      currentFmv: 5,
      vestingSchedule: [{ date: '2025-06-01', cumulativePct: 1.0 }],
    };
    const pts = vestingChartData([singleVest]);
    expect(pts).toHaveLength(1);
    expect(pts[0].date).toBe('2025-06-01');
    expect(pts[0].vestedValue).toBeCloseTo(500);
  });
});

// Base grant for grantOrdinaryIncomeOnVest tests:
// - 1000 shares @ FMV $50, 25% vested on 2020-01-15 (past), 100% on 2099-01-15 (far future)
// - At "today" (2026-05-31, between the two), unvestedShares = 750
const baseOrdinaryGrant = {
  grantDate: '2019-01-15',
  strikePrice: 0,
  totalShares: 1000,
  currentFmv: 50,
  vestingSchedule: [
    { date: '2020-01-15', cumulativePct: 0.25 },
    { date: '2099-01-15', cumulativePct: 1.0 },
  ],
};
const today2026 = new Date('2026-05-31');

describe('grantOrdinaryIncomeOnVest', () => {
  it('RSU: unvestedShares × currentFmv (strike is 0)', () => {
    // unvestedShares = 750, fmv = 50 → 750 × 50 = 37500
    const result = grantOrdinaryIncomeOnVest(
      { ...baseOrdinaryGrant, grantType: GrantType.RSU },
      today2026,
    );
    expect(result).toBeCloseTo(37500);
  });

  it('NSO: unvestedShares × (currentFmv − strikePrice), spread positive', () => {
    // strike = 10, fmv = 50, spread = 40 → 750 × 40 = 30000
    const result = grantOrdinaryIncomeOnVest(
      { ...baseOrdinaryGrant, grantType: GrantType.NSO, strikePrice: 10 },
      today2026,
    );
    expect(result).toBeCloseTo(30000);
  });

  it('NSO: floored at 0 when strike > fmv (underwater option)', () => {
    // strike = 60, fmv = 50, spread = -10 → max(0,-10) = 0 → 0
    const result = grantOrdinaryIncomeOnVest(
      { ...baseOrdinaryGrant, grantType: GrantType.NSO, strikePrice: 60 },
      today2026,
    );
    expect(result).toBe(0);
  });

  it('ISO: always 0 (bargain element is an AMT preference, not ordinary income)', () => {
    const result = grantOrdinaryIncomeOnVest(
      { ...baseOrdinaryGrant, grantType: GrantType.ISO, strikePrice: 10 },
      today2026,
    );
    expect(result).toBe(0);
  });

  it('returns 0 when fully vested (no unvested shares)', () => {
    // all vests in the past
    const fullyVested = {
      ...baseOrdinaryGrant,
      grantType: GrantType.RSU,
      vestingSchedule: [
        { date: '2019-01-15', cumulativePct: 0.5 },
        { date: '2020-01-15', cumulativePct: 1.0 },
      ],
    };
    expect(grantOrdinaryIncomeOnVest(fullyVested, today2026)).toBe(0);
  });
});

describe('isIsoAmtPreference', () => {
  it('returns true for ISO', () => {
    expect(isIsoAmtPreference(GrantType.ISO)).toBe(true);
  });

  it('returns false for RSU', () => {
    expect(isIsoAmtPreference(GrantType.RSU)).toBe(false);
  });

  it('returns false for NSO', () => {
    expect(isIsoAmtPreference(GrantType.NSO)).toBe(false);
  });
});
