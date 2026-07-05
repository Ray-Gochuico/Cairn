import { describe, it, expect } from 'vitest';
import { buildProjectionChartData } from '@/lib/calculators/projection-chart';
import { yearsToFi } from '@/lib/financial-independence';
import { realRateOf } from '@/lib/calculators/real-rate';

/** First charted year whose scenario value meets/exceeds that row's target. */
function crossingYear(rows: Record<string, number>[], key: string): number | null {
  for (const r of rows) {
    if (r[key] >= r.target) return r.year;
  }
  return null;
}

describe('buildProjectionChartData — target-line basis (nominal-on-real, 4th instance)', () => {
  // HISTORICAL-ANCHOR (repo rule for this bug class): pin a full scenario and
  // assert the chart-series crossing equals the table's solve, in BOTH modes.
  // Scenario A — zero contributions, so the closed form is exact:
  //   pv $500k, target $1M (today's dollars), 7% nominal, 3% inflation.
  //   Real rate = 1.07/1.03 − 1 ≈ 3.8835% → yearsToFi = ln(2)/ln(1.038835) ≈ 18.19.
  //   The chart samples integer years → first crossing at year 19.
  //   (The pre-fix flat nominal target crossed at year 11 — optimistic by 8 years.)
  const scenarioA = {
    pv: 500_000,
    annualContribution: 0,
    targetFv: 1_000_000,
    scenarios: [{ label: 'Moderate', rate: 0.07 }],
    inflation: 0.03,
    horizon: 30,
  };

  it('NOMINAL crossing equals the table solve (ceil of the real-rate years)', () => {
    const rows = buildProjectionChartData({ ...scenarioA, displayMode: 'NOMINAL' });
    const solve = yearsToFi({
      pv: scenarioA.pv,
      pmt: 0,
      annualRate: realRateOf(0.07, 0.03),
      targetFv: scenarioA.targetFv,
    });
    expect(Math.ceil(solve)).toBe(19);
    expect(crossingYear(rows, 'Moderate')).toBe(19);
  });

  it('REAL crossing is the SAME year (display mode cannot move the goalpost)', () => {
    const rows = buildProjectionChartData({ ...scenarioA, displayMode: 'REAL' });
    expect(crossingYear(rows, 'Moderate')).toBe(19);
  });

  it('WITH contributions the crossing equals the table solve in BOTH modes (historical anchor)', () => {
    // pv $100k, $20k/yr real-flat, 6% nominal, 2.5% inflation, target $1M real.
    // Real rate = 1.06/1.025 − 1 ≈ 3.4146%; yearsToFi ≈ 24.97 → first charted
    // crossing at year 25. The pre-fix flat-NOMINAL contribution crossed at
    // year 30 (the OLD expectation below) — ~5 years LATE vs the solve, the
    // review's "15.2y table vs year-17 chart" pessimism class.
    const scenarioB = {
      pv: 100_000,
      annualContribution: 20_000,
      targetFv: 1_000_000,
      scenarios: [{ label: 'Moderate', rate: 0.06 }],
      inflation: 0.025,
      horizon: 40,
    };
    const solve = yearsToFi({
      pv: scenarioB.pv,
      pmt: scenarioB.annualContribution,
      annualRate: realRateOf(0.06, 0.025),
      targetFv: scenarioB.targetFv,
    });
    const expected = Math.ceil(solve);
    const nominal = crossingYear(
      buildProjectionChartData({ ...scenarioB, displayMode: 'NOMINAL' }),
      'Moderate',
    );
    const real = crossingYear(
      buildProjectionChartData({ ...scenarioB, displayMode: 'REAL' }),
      'Moderate',
    );
    expect(nominal).toBe(expected);
    expect(real).toBe(expected);
  });

  it('NOMINAL target grows by (1+i)^t; REAL target is flat at targetFv', () => {
    const nominal = buildProjectionChartData({ ...scenarioA, displayMode: 'NOMINAL' });
    expect(nominal[0].target).toBeCloseTo(1_000_000, 6);
    expect(nominal[10].target).toBeCloseTo(1_000_000 * 1.03 ** 10, 6);
    const real = buildProjectionChartData({ ...scenarioA, displayMode: 'REAL' });
    for (const row of real) {
      expect(row.target).toBeCloseTo(1_000_000, 5);
    }
  });

  it('emits one row per year 0..horizon with a key per scenario label', () => {
    const rows = buildProjectionChartData({
      ...scenarioA,
      scenarios: [
        { label: 'Conservative', rate: 0.05 },
        { label: 'Moderate', rate: 0.07 },
      ],
      displayMode: 'NOMINAL',
      horizon: 5,
    });
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ year: 0, Conservative: 500_000, Moderate: 500_000 });
  });

  it('horizon 0 yields the single year-0 row (CoastFI at-retirement edge)', () => {
    const rows = buildProjectionChartData({ ...scenarioA, displayMode: 'NOMINAL', horizon: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe(0);
  });
});
