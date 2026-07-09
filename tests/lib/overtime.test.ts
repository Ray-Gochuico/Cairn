import { describe, it, expect } from 'vitest';
import {
  evaluateOvertimeLineItems,
  impliedHourlyRate,
  obbbaOvertimeDeduction,
  type OvertimeLineItem,
} from '@/lib/overtime';
import { FilingStatus } from '@/types/enums';

describe('evaluateOvertimeLineItems', () => {
  const BASE_RATE = 25; // $/hr

  it('computes single line-item at 1.5x (no holiday)', () => {
    const items: OvertimeLineItem[] = [
      { hours: 8, baseMultiplier: 1.5, holidayMultiplier: null, stackMultipliers: false },
    ];
    const result = evaluateOvertimeLineItems(items, BASE_RATE);
    // 8 × 25 × 1.5 = 300
    expect(result.lineItems[0].gross).toBeCloseTo(300, 2);
    expect(result.totalGross).toBeCloseTo(300, 2);
  });

  it('applies holiday multiplier stacked (stack=true): base × holiday', () => {
    const items: OvertimeLineItem[] = [
      { hours: 4, baseMultiplier: 1.5, holidayMultiplier: 2, stackMultipliers: true },
    ];
    const result = evaluateOvertimeLineItems(items, BASE_RATE);
    // 4 × 25 × (1.5 × 2) = 4 × 25 × 3 = 300
    expect(result.lineItems[0].effectiveMultiplier).toBeCloseTo(3, 4);
    expect(result.lineItems[0].gross).toBeCloseTo(300, 2);
  });

  it('applies holiday multiplier non-stacked (stack=false): max(base, holiday)', () => {
    const items: OvertimeLineItem[] = [
      { hours: 4, baseMultiplier: 1.5, holidayMultiplier: 2, stackMultipliers: false },
    ];
    const result = evaluateOvertimeLineItems(items, BASE_RATE);
    // max(1.5, 2) = 2; 4 × 25 × 2 = 200
    expect(result.lineItems[0].effectiveMultiplier).toBeCloseTo(2, 4);
    expect(result.lineItems[0].gross).toBeCloseTo(200, 2);
  });

  it('sums multiple line-items correctly (tiered OT scenario)', () => {
    // CA daily OT: first 4 hrs at 1.5x, next 2 hrs at 2x
    const items: OvertimeLineItem[] = [
      { hours: 4, baseMultiplier: 1.5, holidayMultiplier: null, stackMultipliers: false },
      { hours: 2, baseMultiplier: 2, holidayMultiplier: null, stackMultipliers: false },
    ];
    const result = evaluateOvertimeLineItems(items, BASE_RATE);
    // 4×25×1.5=150, 2×25×2=100 → total 250
    expect(result.totalGross).toBeCloseTo(250, 2);
    expect(result.lineItems).toHaveLength(2);
  });

  it('throws on negative hours', () => {
    expect(() =>
      evaluateOvertimeLineItems(
        [{ hours: -1, baseMultiplier: 1.5, holidayMultiplier: null, stackMultipliers: false }],
        BASE_RATE,
      ),
    ).toThrow();
  });

  it('throws on non-positive base rate', () => {
    expect(() =>
      evaluateOvertimeLineItems(
        [{ hours: 4, baseMultiplier: 1.5, holidayMultiplier: null, stackMultipliers: false }],
        0,
      ),
    ).toThrow();
  });

  it('adds the per-row shift differential to the base rate before the multiplier', () => {
    const items: OvertimeLineItem[] = [
      { hours: 8, baseMultiplier: 1.5, holidayMultiplier: null, stackMultipliers: false, shiftDifferential: 3 },
    ];
    const result = evaluateOvertimeLineItems(items, 25);
    // (25 + 3) × 1.5 × 8 = 28 × 12 = 336
    expect(result.lineItems[0].effectiveBaseRate).toBeCloseTo(28, 6);
    expect(result.lineItems[0].gross).toBeCloseTo(336, 2);
  });

  it('treats a missing shift differential as 0 (back-compat)', () => {
    const result = evaluateOvertimeLineItems(
      [{ hours: 8, baseMultiplier: 1.5, holidayMultiplier: null, stackMultipliers: false }],
      25,
    );
    expect(result.lineItems[0].effectiveBaseRate).toBeCloseTo(25, 6);
    expect(result.lineItems[0].gross).toBeCloseTo(300, 2);
  });
});

it('totalPremium is the pay above straight-time', () => {
  // 8 hrs @ $25 × 1.5 → gross 300; straight-time 8×25=200; premium 100
  const r = evaluateOvertimeLineItems(
    [{ hours: 8, baseMultiplier: 1.5, holidayMultiplier: null, stackMultipliers: false }],
    25,
  );
  expect(r.totalPremium).toBeCloseTo(100, 2);
});
it('totalPremium includes the shift differential in the regular rate', () => {
  // (25+5)=30; 8×30×1.5=360; straight 8×30=240; premium 120
  const r = evaluateOvertimeLineItems(
    [{ hours: 8, baseMultiplier: 1.5, holidayMultiplier: null, stackMultipliers: false, shiftDifferential: 5 }],
    25,
  );
  expect(r.totalPremium).toBeCloseTo(120, 2);
});
describe('obbbaOvertimeDeduction', () => {
  it('caps the premium at $12,500 (single) / $25,000 (MFJ)', () => {
    expect(obbbaOvertimeDeduction(5_000, FilingStatus.SINGLE)).toBe(5_000);
    expect(obbbaOvertimeDeduction(20_000, FilingStatus.SINGLE)).toBe(12_500);
    expect(obbbaOvertimeDeduction(40_000, FilingStatus.MFJ)).toBe(25_000);
  });
  it('floors at 0', () => {
    expect(obbbaOvertimeDeduction(-100, FilingStatus.SINGLE)).toBe(0);
  });
});

describe('impliedHourlyRate', () => {
  it('computes implied hourly rate for a typical salary', () => {
    // $80,000 / (40 × 52) = $80,000 / 2080 ≈ $38.4615
    expect(impliedHourlyRate(80000, 40)).toBeCloseTo(38.4615, 4);
  });

  it('returns exact $25/hr for $52,000 / (40 × 52)', () => {
    // $52,000 / 2080 = $25 exactly
    expect(impliedHourlyRate(52000, 40)).toBeCloseTo(25, 6);
  });

  it('throws on non-positive regular hours per week', () => {
    expect(() => impliedHourlyRate(80000, 0)).toThrow();
    expect(() => impliedHourlyRate(80000, -10)).toThrow();
  });
});

describe('wave-9 M60/M62 — OBBBA qualification', () => {
  it('MFS gets NO overtime deduction (OBBBA denies married-filing-separately)', () => {
    expect(obbbaOvertimeDeduction(10_000, FilingStatus.MFS)).toBe(0);
    expect(obbbaOvertimeDeduction(10_000, FilingStatus.SINGLE)).toBe(10_000);
    expect(obbbaOvertimeDeduction(30_000, FilingStatus.MFJ)).toBe(25_000);
  });

  it('totalQualifiedPremium caps the per-hour premium at 0.5× the regular rate', () => {
    const r = evaluateOvertimeLineItems(
      [
        { hours: 10, baseMultiplier: 1.5, holidayMultiplier: null, stackMultipliers: false }, // premium 0.5×
        { hours: 4, baseMultiplier: 2.0, holidayMultiplier: null, stackMultipliers: false },  // premium 1.0×, qualified 0.5×
      ],
      20,
    );
    // Full premium: 10×20×0.5 + 4×20×1.0 = 100 + 80 = 180.
    expect(r.totalPremium).toBeCloseTo(180, 10);
    // Qualified: 10×20×0.5 + 4×20×0.5 = 100 + 40 = 140.
    expect(r.totalQualifiedPremium).toBeCloseTo(140, 10);
  });
});
