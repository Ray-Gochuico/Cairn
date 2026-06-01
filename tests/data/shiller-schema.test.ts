import { describe, it, expect } from 'vitest';
import { loadShillerAnnual, ShillerAnnualRowSchema } from '@/data/shiller-schema';

describe('Shiller data asset', () => {
  it('loads and validates every row', () => {
    const rows = loadShillerAnnual();
    expect(rows.length).toBeGreaterThan(140); // 1871..2022 = 152
    expect(() => rows.forEach((r) => ShillerAnnualRowSchema.parse(r))).not.toThrow();
  });

  it('starts at 1871 and is contiguous (no missing years)', () => {
    const rows = loadShillerAnnual();
    expect(rows[0].year).toBe(1871);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].year).toBe(rows[i - 1].year + 1);
    }
  });

  it('ends at the last full year available in the source workbook (2022)', () => {
    const rows = loadShillerAnnual();
    expect(rows[rows.length - 1].year).toBe(2022);
  });

  it('rejects a row with a non-positive CPI', () => {
    expect(() =>
      ShillerAnnualRowSchema.parse({
        year: 1900,
        sp500NominalReturn: 0.05,
        sp500RealReturn: 0.03,
        tenYearTreasuryReturn: 0.02,
        cpi: 0,
      }),
    ).toThrow();
  });

  it('rejects a row with a non-finite return', () => {
    expect(() =>
      ShillerAnnualRowSchema.parse({
        year: 1900,
        sp500NominalReturn: Number.NaN,
        sp500RealReturn: 0.03,
        tenYearTreasuryReturn: 0.02,
        cpi: 10,
      }),
    ).toThrow();
  });

  // MF-3 — HARD VALUE ANCHORS. Zod proves shape + contiguity but NOT that a
  // cell was transcribed correctly; a wrong return would only surface as a
  // skew hidden inside the engine's success-rate band. These pin specific,
  // independently-verifiable historical cells to the Shiller series so a
  // fat-fingered transcription (or a column/row shift in the extraction)
  // fails LOUDLY here.
  //
  // Figures below are the ACTUAL transcribed cells from ie_data.xls
  // (computed from Shiller's own Real Total Return Price index + January CPI;
  // see src/data/shiller.ts header). The wide tolerances absorb the
  // monthly-average-price gap vs. documented calendar close-to-close returns,
  // NOT a wrong cell.
  it('anchors 1931 — the worst Depression year (deep negative nominal return)', () => {
    const row = rowFor(1931);
    // Shiller annual: -0.4426. Documented S&P total return ~ -43%.
    expect(row.sp500NominalReturn).toBeLessThan(-0.35);
    expect(row.sp500NominalReturn).toBeGreaterThan(-0.5);
  });

  it('anchors 2008 — the GFC crash year (~-37% nominal)', () => {
    const row = rowFor(2008);
    // Shiller annual: -0.3563. Documented S&P total return ~ -37%.
    expect(row.sp500NominalReturn).toBeCloseTo(-0.37, 1); // within ±0.05
  });

  it('anchors 1954 — a documented boom year (~+52% nominal)', () => {
    const row = rowFor(1954);
    // Shiller annual: +0.4683. Documented S&P total return ~ +52%.
    expect(row.sp500NominalReturn).toBeGreaterThan(0.45);
  });

  it('anchors a CPI level — 1913 base era CPI is ~9.8 (Shiller index)', () => {
    // CPI is an index level, not a rate; pin one early cell so a shifted
    // column (e.g. off-by-one-row) is caught. ie_data.xls Jan-1913 CPI = 9.8.
    const row = rowFor(1913);
    expect(row.cpi).toBeGreaterThan(8);
    expect(row.cpi).toBeLessThan(12);
  });
});

function rowFor(year: number) {
  const row = loadShillerAnnual().find((r) => r.year === year);
  if (!row) throw new Error(`expected a Shiller row for ${year}`);
  return row;
}
