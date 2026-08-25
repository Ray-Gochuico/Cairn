import { describe, it, expect } from 'vitest';
import {
  TUITION_BASE_ACADEMIC_YEAR, TUITION_SECTORS, TUITION_STICKER,
  TUITION_REAL_GROWTH, TUITION_SECTOR_LABELS, STATE_PUBLIC_4YR_TUITION_FEES,
  getTuition,
} from '@/data/tuition-reference';

describe('tuition-reference dataset', () => {
  it('SOURCE ANCHOR: public 4yr in-state tuition+fees matches the College Board published average', () => {
    // Trends in College Pricing and Student Aid 2025, Table CP-1 (Excel data
    // workbook, tables prepared October 2025; retrieved 2026-08-25):
    // $11,950 for 2025-26, independently stated in the College Board
    // newsroom release (2025-11-06) and the Trends highlights page. If
    // re-sourcing moved this number, update the module AND this pin from the
    // SAME retrieval, and update the header citation.
    expect(TUITION_BASE_ACADEMIC_YEAR).toBe('2025-26');
    expect(TUITION_STICKER.PUBLIC_4YR_IN_STATE.tuitionFees).toBe(11_950);
  });

  it('SOURCE ANCHORS: every sticker row matches Table CP-1 (retrieved 2026-08-25)', () => {
    expect(TUITION_STICKER.PUBLIC_4YR_OUT_OF_STATE.tuitionFees).toBe(31_880);
    expect(TUITION_STICKER.PRIVATE_NONPROFIT_4YR.tuitionFees).toBe(45_000);
    expect(TUITION_STICKER.PUBLIC_2YR_IN_DISTRICT.tuitionFees).toBe(4_150);
    // Housing and food, same table. The source DOES publish a public
    // two-year figure ($10,850) — no fabricated null.
    expect(TUITION_STICKER.PUBLIC_4YR_IN_STATE.housingFood).toBe(13_900);
    expect(TUITION_STICKER.PUBLIC_4YR_OUT_OF_STATE.housingFood).toBe(13_900);
    expect(TUITION_STICKER.PRIVATE_NONPROFIT_4YR.housingFood).toBe(15_920);
    expect(TUITION_STICKER.PUBLIC_2YR_IN_DISTRICT.housingFood).toBe(10_850);
  });

  it('every published growth rate is EXPLICITLY real (nominal-on-real class guard) and sane', () => {
    // Figure CP-4 publishes constant-dollar decade changes for three
    // sectors only; the out-of-state sector has no over-time series in the
    // 2025 edition and ships null (never a proxy, never an invented rate).
    expect(TUITION_REAL_GROWTH.PUBLIC_4YR_OUT_OF_STATE).toBeNull();
    for (const s of TUITION_SECTORS) {
      const g = TUITION_REAL_GROWTH[s];
      if (g === null) continue; // out-of-state, asserted above
      expect(g.basis).toBe('real');
      expect(g.windowYears).toBe(10);
      expect(g.pctPerYear).toBeGreaterThan(-3);
      expect(g.pctPerYear).toBeLessThan(6);
    }
  });

  it('GROWTH ANCHORS: annualized Figure CP-4 decade totals (2015-16 to 2025-26)', () => {
    // Published decade totals (constant 2025 dollars): private nonprofit
    // +2.4357%, public 4yr in-state −6.7135%, public 2yr −10.1732%.
    // Stored per-year: ((1+total)^(1/10) − 1) × 100, rounded to 4 decimals.
    expect(TUITION_REAL_GROWTH.PRIVATE_NONPROFIT_4YR?.pctPerYear).toBe(0.2409);
    expect(TUITION_REAL_GROWTH.PUBLIC_4YR_IN_STATE?.pctPerYear).toBe(-0.6925);
    expect(TUITION_REAL_GROWTH.PUBLIC_2YR_IN_DISTRICT?.pctPerYear).toBe(-1.0671);
  });

  it('sticker rows are complete and plausible', () => {
    expect(TUITION_SECTORS).toHaveLength(4);
    for (const s of TUITION_SECTORS) {
      expect(TUITION_STICKER[s].tuitionFees).toBeGreaterThan(1_000);
      expect(TUITION_STICKER[s].tuitionFees).toBeLessThan(100_000);
      expect(TUITION_SECTOR_LABELS[s].length).toBeGreaterThan(0);
    }
    expect(TUITION_STICKER.PUBLIC_4YR_IN_STATE.housingFood).not.toBeNull();
    expect(TUITION_STICKER.PRIVATE_NONPROFIT_4YR.housingFood).not.toBeNull();
  });

  it('per-state table: 50 well-formed state rows from Figure CP-6 (no US aggregate row)', () => {
    const entries = Object.entries(STATE_PUBLIC_4YR_TUITION_FEES);
    expect(entries.length).toBe(50);
    expect(STATE_PUBLIC_4YR_TUITION_FEES.US).toBeUndefined();
    for (const [st, v] of entries) {
      expect(st).toMatch(/^[A-Z]{2}$/);
      expect(v).toBeGreaterThan(3_000);
      expect(v).toBeLessThan(30_000);
    }
    // Range anchors, as published in the report highlights: FL is the
    // lowest and VT the highest 2025-26 in-state figure.
    expect(STATE_PUBLIC_4YR_TUITION_FEES.FL).toBe(6_360);
    expect(STATE_PUBLIC_4YR_TUITION_FEES.VT).toBe(18_090);
    expect(Math.min(...Object.values(STATE_PUBLIC_4YR_TUITION_FEES))).toBe(6_360);
    expect(Math.max(...Object.values(STATE_PUBLIC_4YR_TUITION_FEES))).toBe(18_090);
  });

  it('getTuition: state hit is state-specific; miss falls back to national', () => {
    const miss = getTuition('PUBLIC_4YR_IN_STATE', 'ZZ');
    expect(miss.stateSpecific).toBe(false);
    expect(miss.tuitionFees).toBe(TUITION_STICKER.PUBLIC_4YR_IN_STATE.tuitionFees);
    const hit = getTuition('PUBLIC_4YR_IN_STATE', 'FL');
    expect(hit.stateSpecific).toBe(true);
    expect(hit.tuitionFees).toBe(6_360);
    expect(hit.housingFood).toBe(13_900); // housing stays the national average
    // Non-in-state sectors never consult the state table:
    expect(getTuition('PRIVATE_NONPROFIT_4YR', 'NY').stateSpecific).toBe(false);
    expect(getTuition('PUBLIC_4YR_OUT_OF_STATE', 'FL').stateSpecific).toBe(false);
  });
});
