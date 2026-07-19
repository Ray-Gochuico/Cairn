import { describe, it, expect } from 'vitest';
import { computeEquityValue, computeFmvFromCompanyValuation, vestingChartData, grantOrdinaryIncomeOnVest, isIsoAmtPreference } from '@/lib/equity-value';
import { GrantType } from '@/types/enums';

const grant = {
  grantDate: '2024-01-15',
  // Legacy fixture: RSU-typed so the full-FMV pins below stay valid (wave-9
  // M64 nets the strike for NSO/ISO only).
  grantType: GrantType.RSU,
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
    const result = computeEquityValue(grant, '2024-06-01');
    expect(result.vestedShares).toBe(0);
    expect(result.vestedValue).toBe(0);
  });

  it('takes a LOCAL ISO day and is exact on the vest-date boundary (Wave 11 T10)', () => {
    const g = { ...grant, vestingSchedule: [{ date: '2026-07-09', cumulativePct: 1.0 }] };
    // day before the vest: unvested
    expect(computeEquityValue(g, '2026-07-08').vestedShares).toBe(0);
    // the vest day itself (<=): vested
    expect(computeEquityValue(g, '2026-07-09').vestedShares).toBe(1000);
  });

  it('returns 25% vested after first cliff', () => {
    const result = computeEquityValue(grant, '2025-06-01');
    expect(result.vestedShares).toBe(250);
    expect(result.vestedValue).toBe(250 * 50);
    expect(result.unvestedShares).toBe(750);
  });

  it('returns 100% vested after final entry', () => {
    const result = computeEquityValue(grant, '2029-01-01');
    expect(result.vestedShares).toBe(1000);
    expect(result.unvestedShares).toBe(0);
  });

  it('upcoming vest dates lists next 3 future entries', () => {
    const result = computeEquityValue(grant, '2025-06-01');
    expect(result.upcomingVestDates).toEqual(['2026-01-15', '2027-01-15', '2028-01-15']);
  });

  it('monthlyCost amortizes total strike cost over vesting duration', () => {
    // total strike = 5 * 1000 = 5000; vesting duration = 48 months
    const result = computeEquityValue(grant, '2025-06-01');
    expect(result.monthlyCost).toBeCloseTo(5000 / 48, 2);
  });

  // Bonus tests
  it('strike price = 0 (RSU) yields monthlyCost = 0', () => {
    const rsuGrant = { ...grant, strikePrice: 0 };
    const result = computeEquityValue(rsuGrant, '2025-06-01');
    expect(result.monthlyCost).toBe(0);
  });

  it('single-entry schedule (immediate full vest at grant date) is fully vested with no monthly cost', () => {
    const immediateGrant = {
      grantDate: '2024-01-15',
      grantType: GrantType.RSU,
      strikePrice: 10,
      totalShares: 100,
      currentFmv: 25,
      vestingSchedule: [{ date: '2024-01-15', cumulativePct: 1.0 }],
    };
    const result = computeEquityValue(immediateGrant, '2024-06-01');
    // Wave-9 F9: the old pin (monthlyCost 1000 forever) WAS the bug — a
    // fully-vested grant has no remaining strike outlay. The max(1, ...)
    // duration clamp still guards the division for in-flight schedules.
    expect(result.monthlyCost).toBe(0);
    expect(result.vestedShares).toBe(100);
    expect(result.unvestedShares).toBe(0);
  });

  it('today exactly on a vest date counts that entry (<= condition)', () => {
    // 2025-01-15 is exactly the first vest date; pct should be 0.25
    const result = computeEquityValue(grant, '2025-01-15');
    expect(result.vestedShares).toBe(250);
  });

  it('upcomingVestDates is empty array when fully vested', () => {
    const result = computeEquityValue(grant, '2029-01-01');
    expect(result.upcomingVestDates).toEqual([]);
  });

  it('currentFmv = 0 yields vestedValue = 0 regardless of shares', () => {
    const zeroFmvGrant = { ...grant, currentFmv: 0 };
    const result = computeEquityValue(zeroFmvGrant, '2025-06-01');
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
      grantType: GrantType.RSU,
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
      grantType: GrantType.RSU,
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
      grantType: GrantType.RSU,
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
  grantType: GrantType.RSU,
  strikePrice: 0,
  totalShares: 1000,
  currentFmv: 50,
  vestingSchedule: [
    { date: '2020-01-15', cumulativePct: 0.25 },
    { date: '2099-01-15', cumulativePct: 1.0 },
  ],
};
const today2026 = '2026-05-31';

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

describe('monthlyCost fully-vested clamp (wave-9 F9)', () => {
  it('monthlyCost clamps to $0 once the grant is fully vested (wave-9 F9)', () => {
    const grant = {
      grantDate: '2024-01-01',
      grantType: GrantType.RSU,
      strikePrice: 5,
      totalShares: 1000,
      currentFmv: 20,
      vestingSchedule: [
        { date: '2025-01-01', cumulativePct: 0.5 },
        { date: '2026-01-01', cumulativePct: 1 },
      ],
    };
    const during = computeEquityValue(grant, '2025-06-01');
    expect(during.monthlyCost).toBeCloseTo(5000 / 24, 6); // vesting in flight: period average
    const after = computeEquityValue(grant, '2029-01-01');
    expect(after.monthlyCost).toBe(0);
    expect(after.upcomingVestDates).toEqual([]);
  });
});

describe('option value nets the strike (wave-9 M64)', () => {
  const nso = (fmv: number) => ({
    grantDate: '2024-01-01', strikePrice: 10, totalShares: 1000, currentFmv: fmv,
    grantType: GrantType.NSO,
    vestingSchedule: [{ date: '2025-01-01', cumulativePct: 0.5 }, { date: '2026-01-01', cumulativePct: 1 }],
  });
  const T = '2025-06-01';

  it('in-the-money NSO: value = (fmv − strike) × shares', () => {
    const r = computeEquityValue(nso(17), T);
    expect(r.vestedValue).toBeCloseTo(500 * 7, 6);
    expect(r.unvestedValue).toBeCloseTo(500 * 7, 6);
  });

  it('underwater NSO is worth $0, not full FMV', () => {
    const r = computeEquityValue(nso(6), T);
    expect(r.vestedValue).toBe(0);
    expect(r.unvestedValue).toBe(0);
  });

  it('RSU keeps full FMV (strike 0 semantics unchanged)', () => {
    const r = computeEquityValue({ ...nso(17), grantType: GrantType.RSU, strikePrice: 0 }, T);
    expect(r.vestedValue).toBeCloseTo(500 * 17, 6);
  });

  it('vestingChartData nets the strike too', () => {
    const pts = vestingChartData([nso(17)]);
    expect(pts[pts.length - 1].vestedValue).toBeCloseTo(1000 * 7, 6);
  });
});

// ── Wave 18 C11 — forward-vest window + chart (D10) ─────────────────────────

describe('vestsInWindow (Wave 18)', () => {
  const { GrantType: GT } = { GrantType };
  const rsu = {
    grantDate: '2025-01-15',
    grantType: GT.RSU,
    strikePrice: 0,
    totalShares: 1000,
    currentFmv: 40,
    vestingSchedule: [
      { date: '2026-01-15', cumulativePct: 0.25 },
      { date: '2026-07-15', cumulativePct: 0.5 },
      { date: '2027-01-15', cumulativePct: 0.75 },
      { date: '2027-07-15', cumulativePct: 1.0 },
    ],
  };

  it('returns per-event shares/value in (today, today + months]; past entries set the delta base', async () => {
    const { vestsInWindow } = await import('@/lib/equity-value');
    // Today 2026-05-14: 25% already vested. Next 12 months window ends
    // 2027-05-14 → includes 2026-07-15 (+25%) and 2027-01-15 (+25%).
    const w = vestsInWindow([rsu], '2026-05-14', 12);
    expect(w.events).toHaveLength(2);
    expect(w.events[0]).toMatchObject({ date: '2026-07-15', shares: 250, value: 10000 });
    expect(w.events[1]).toMatchObject({ date: '2027-01-15', shares: 250, value: 10000 });
    expect(w.totalValue).toBe(20000);
    // RSU ordinary income = full FMV.
    expect(w.totalOrdinaryIncome).toBe(20000);
  });

  it('window edges: a vest exactly at today is EXCLUDED; exactly at today + months is INCLUDED', async () => {
    const { vestsInWindow } = await import('@/lib/equity-value');
    const g = {
      ...rsu,
      vestingSchedule: [
        { date: '2026-05-14', cumulativePct: 0.5 },
        { date: '2027-05-14', cumulativePct: 1.0 },
      ],
    };
    const w = vestsInWindow([g], '2026-05-14', 12);
    expect(w.events.map((e) => e.date)).toEqual(['2027-05-14']);
    expect(w.events[0].shares).toBe(500);
  });

  it('a fully-vested grant yields no events', async () => {
    const { vestsInWindow } = await import('@/lib/equity-value');
    expect(vestsInWindow([rsu], '2028-01-01', 12).events).toHaveLength(0);
  });

  it('options net the strike (floored at 0) for value; NSO income = spread, ISO income = 0', async () => {
    const { vestsInWindow } = await import('@/lib/equity-value');
    const nso = { ...rsu, grantType: GT.NSO, strikePrice: 15 };
    const wNso = vestsInWindow([nso], '2026-05-14', 12);
    // Holder value per share = 40 − 15 = 25 → 250 shares × 25 = 6,250/event.
    expect(wNso.events[0].value).toBe(6250);
    expect(wNso.totalOrdinaryIncome).toBe(12500);
    const iso = { ...rsu, grantType: GT.ISO, strikePrice: 15 };
    const wIso = vestsInWindow([iso], '2026-05-14', 12);
    expect(wIso.events[0].value).toBe(6250);
    expect(wIso.totalOrdinaryIncome).toBe(0); // AMT preference, not ordinary income
    const underwater = { ...rsu, grantType: GT.NSO, strikePrice: 90 };
    expect(vestsInWindow([underwater], '2026-05-14', 12).totalValue).toBe(0);
  });

  it('merges + date-sorts events across grants', async () => {
    const { vestsInWindow } = await import('@/lib/equity-value');
    const other = {
      ...rsu,
      currentFmv: 10,
      vestingSchedule: [{ date: '2026-06-01', cumulativePct: 1.0 }],
    };
    const w = vestsInWindow([rsu, other], '2026-05-14', 12);
    expect(w.events.map((e) => e.date)).toEqual(['2026-06-01', '2026-07-15', '2027-01-15']);
  });
});

describe('forwardVestChartData (Wave 18 D10)', () => {
  it('buckets the next N months cumulatively, starting at 0, with Mon ’YY labels', async () => {
    const { forwardVestChartData } = await import('@/lib/equity-value');
    const g = {
      grantDate: '2025-01-15',
      grantType: GrantType.RSU,
      strikePrice: 0,
      totalShares: 1000,
      currentFmv: 40,
      vestingSchedule: [
        { date: '2026-01-15', cumulativePct: 0.25 },
        { date: '2026-07-15', cumulativePct: 0.5 },
        { date: '2027-01-15', cumulativePct: 0.75 },
        { date: '2027-07-15', cumulativePct: 1.0 },
      ],
    };
    const rows = forwardVestChartData([g], '2026-05-14', 24);
    expect(rows).toHaveLength(24);
    expect(rows[0].month).toBe('2026-06');
    expect(rows[0].label).toBe('Jun ’26');
    expect(rows[0].cumulativeValue).toBe(0);
    // 2026-07 bucket carries the +250-share vest → 10,000; stays cumulative.
    const jul = rows.find((r) => r.month === '2026-07')!;
    expect(jul.cumulativeValue).toBe(10000);
    const feb27 = rows.find((r) => r.month === '2027-02')!;
    expect(feb27.cumulativeValue).toBe(20000);
    const end = rows[rows.length - 1];
    expect(end.month).toBe('2028-05');
    // 25% was already vested at 2026-05-14 — the forward ramp tops out at the
    // remaining 75% (750 shares × $40 = $30,000), NOT the full grant value.
    expect(end.cumulativeValue).toBe(30000);
  });

  it('returns an all-zero ramp when nothing vests forward', async () => {
    const { forwardVestChartData } = await import('@/lib/equity-value');
    const g = {
      grantDate: '2020-01-15',
      grantType: GrantType.RSU,
      strikePrice: 0,
      totalShares: 100,
      currentFmv: 10,
      vestingSchedule: [{ date: '2021-01-15', cumulativePct: 1.0 }],
    };
    const rows = forwardVestChartData([g], '2026-05-14', 24);
    expect(rows.every((r) => r.cumulativeValue === 0)).toBe(true);
  });
});
