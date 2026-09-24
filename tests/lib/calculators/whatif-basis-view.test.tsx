import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildWhatIfCoastLeg,
  toDisplayMilestones,
  useWhatIfBasisView,
  whatIfChartCaption,
  WHATIF_FUTURE_CAPTION,
  TODAY_SUFFIX,
  FUTURE_SUFFIX,
} from '@/lib/calculators/basis-view';
import {
  CALCULATORS_PAGE_ID,
  WHATIF_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import type { Milestones, MonthlyState } from '@/lib/scenarios';

const st = (monthISO: string, netWorth: number): MonthlyState => ({
  monthISO,
  investmentsByAccount: { 1: netWorth },
  homeEquity: 0,
  cash: 0,
  debtByLoan: {},
  netWorth,
  incomeAfterTax: 0,
  expenses: 0,
  savings: 0,
  events: [],
});
// startISO 2026-01: month 2027-01 = 1.0 elapsed years; 2028-07 = 2.5 years.
const PROJECTIONS = new Map<number, MonthlyState[]>([
  [1, [st('2026-01', 100_000), st('2027-01', 200_000), st('2028-07', 300_000)]],
]);
const MILESTONES = new Map<number, Milestones>([
  [1, { netWorth30y: 2_345_000, debtFreeISO: '2029-06' }],
  [2, { netWorth30y: 2_550_000 }],
  [3, {}],
]);
const ARGS = { projections: PROJECTIONS, milestones: MILESTONES, inflation: 0.025, startISO: '2026-01' };

describe('useWhatIfBasisView — the What-If arm of the ONE boundary (D-W51-1)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it("today (default, D-T3): each month deflated by its OWN elapsed years; milestones by 1.025^30; suffix + caption", () => {
    const { result } = renderHook(() => useWhatIfBasisView(ARGS));
    const v = result.current;
    expect(v.basis).toBe('today');
    const rows = v.displayProjections.get(1)!;
    expect(rows[0].netWorth).toBe(100_000); //                     year 0 — identity
    expect(rows[1].netWorth).toBeCloseTo(195_121.9512195122, 6); // 200,000 / 1.025
    expect(rows[2].netWorth).toBeCloseTo(282_040.5748910191, 6); //  300,000 / 1.025^2.5
    expect(v.displayProjections.get(1)).not.toBe(PROJECTIONS.get(1)); // NEW arrays — the engine cache is never mutated
    expect(v.netWorth30yFmt.get(1)).toBe('$1,117,962'); // 2,345,000 / 2.097567579081786
    expect(v.netWorth30yFmt.get(2)).toBe('$1,215,694'); // 2,550,000 / 2.097567579081786
    expect(v.netWorth30yFmt.has(3)).toBe(false);
    expect(v.displayMilestones.get(1)!.basis).toBe('today');
    expect(v.displayMilestones.get(1)!.debtFreeISO).toBe('2029-06'); // dates are basis-invariant
    expect(v.suffix).toBe(TODAY_SUFFIX);
    expect(v.chartCaption).toBe("All lines in today's dollars — one deflator, 2.5% inflation.");
  });

  it('future: the engine maps pass through BY REFERENCE (no copy, no residue); nominal literals; rate-free caption (D-W51-4)', () => {
    const { result } = renderHook(() => useWhatIfBasisView(ARGS));
    act(() => useDollarBasisStore.getState().setBasis(WHATIF_PAGE_ID, 'future'));
    const v = result.current;
    expect(v.basis).toBe('future');
    expect(v.displayProjections).toBe(PROJECTIONS);
    expect(v.netWorth30yFmt.get(1)).toBe('$2,345,000');
    expect(v.netWorth30yFmt.get(2)).toBe('$2,550,000');
    expect(v.displayMilestones.get(1)!.basis).toBe('future');
    expect(v.suffix).toBe(FUTURE_SUFFIX);
    expect(v.chartCaption).toBe(WHATIF_FUTURE_CAPTION);
    expect(v.chartCaption).toBe('All lines in future dollars — not adjusted for inflation.');
  });

  it('page isolation: flipping the CALCULATORS basis never moves the What-If bundle', () => {
    const { result } = renderHook(() => useWhatIfBasisView(ARGS));
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(result.current.basis).toBe('today');
    expect(result.current.netWorth30yFmt.get(1)).toBe('$1,117,962');
  });

  it('F11: 0% inflation — both bases numerically identical; the captions still differ', () => {
    const { result } = renderHook(() => useWhatIfBasisView({ ...ARGS, inflation: 0 }));
    expect(result.current.displayProjections.get(1)![1].netWorth).toBe(200_000);
    expect(result.current.netWorth30yFmt.get(1)).toBe('$2,345,000');
    expect(result.current.chartCaption).toBe("All lines in today's dollars — one deflator, 0% inflation.");
    act(() => useDollarBasisStore.getState().setBasis(WHATIF_PAGE_ID, 'future'));
    expect(result.current.chartCaption).toBe(WHATIF_FUTURE_CAPTION);
  });

  it('null startISO (the page before RealState resolves): projections pass through untouched', () => {
    const { result } = renderHook(() => useWhatIfBasisView({ ...ARGS, startISO: null }));
    expect(result.current.displayProjections).toBe(PROJECTIONS);
  });

  // Review MINOR 4 (D-W51-1 by mechanism): with no start month the chart's
  // per-month deflation cannot run, so the chart map is the NOMINAL engine map.
  // Its caption must follow THAT data — the shipped Future caption, never the
  // today's-dollar one — even while the page basis reads Today. The 30-year
  // recipe needs no start month, so the scoreboard strings stay deflated under
  // their own today's mark (each phrase matches its own math).
  it("null startISO under Today: the caption follows the pass-through data (Future caption), never today's-dollar prose over nominal rows", () => {
    const { result } = renderHook(() => useWhatIfBasisView({ ...ARGS, startISO: null }));
    const v = result.current;
    expect(v.basis).toBe('today');
    expect(v.displayProjections).toBe(PROJECTIONS); //        nominal, by reference
    expect(v.chartCaption).toBe(WHATIF_FUTURE_CAPTION); //    the caption follows the rows
    expect(v.chartCaption).not.toContain("today's dollars");
    expect(v.netWorth30yFmt.get(1)).toBe('$1,117,962'); //    2,345,000 / 1.025^30 — deflated…
    expect(v.suffix).toBe(TODAY_SUFFIX); //                   …and marked as such
    expect(v.displayMilestones.get(1)!.basis).toBe('today');
  });

  it('caption formatting kills float artifacts and trailing zeros (pctFromFraction)', () => {
    expect(whatIfChartCaption('today', 0.0275)).toBe("All lines in today's dollars — one deflator, 2.75% inflation.");
    expect(whatIfChartCaption('today', 0.07 - 0.04)).toBe("All lines in today's dollars — one deflator, 3% inflation.");
    expect(whatIfChartCaption('future', 0.0275)).toBe(WHATIF_FUTURE_CAPTION);
  });
});

describe('toDisplayMilestones — the ONE 30-year recipe (ex-fmtNetWorth30y; D-W3-P7 parity, D-W51-2)', () => {
  it('today divides by (1+i)^30 — a FIXED exponent even when the horizon is shorter (the P7 wrinkle, preserved + chipped)', () => {
    const m = toDisplayMilestones(new Map([[1, { netWorth30y: 900_000, debtFreeISO: '2029-06' }]]), 'today', 0.03).get(1)!;
    expect(m.netWorth30y).toBeCloseTo(370_788.08356431575, 6); // 900,000 / 1.03^30 (the W3 golden derivation)
    expect(m.debtFreeISO).toBe('2029-06');
    expect(m.basis).toBe('today');
  });

  it('future is identity + the brand; undefined stays undefined (never a fake $0)', () => {
    const out = toDisplayMilestones(new Map([[1, { netWorth30y: 900_000 }], [2, {}]]), 'future', 0.03);
    expect(out.get(1)!.netWorth30y).toBe(900_000);
    expect(out.get(2)!.netWorth30y).toBeUndefined();
    expect(out.get(2)!.basis).toBe('future');
  });
});

describe('buildWhatIfCoastLeg — the FI cards coast figure behind the boundary', () => {
  it('floored real-rate discounting: $453,214 (Moderate 6%, 2.5% inflation, 29y, $1.2M); nominal-rate anti-pin $221,468', () => {
    // real = 1.06/1.025 − 1 = 0.034146341463414887 ; coast = 1,200,000 / 1.034146^29 = 453,213.93
    const leg = buildWhatIfCoastLeg({ fiTarget: 1_200_000, rate: 0.06, inflation: 0.025, yearsUntilRetirement: 29 });
    expect(leg.coastFmt).toBe('$453,214');
    expect(leg.coastFmt).not.toBe('$221,468'); // 1,200,000 / 1.06^29 — the W7-Finance nominal-rate bug
    expect(leg.realRateUnfloored).toBeCloseTo(1.06 / 1.025 - 1, 12);
  });

  it('negative real rate floors to zero: coast equals the target; the explainer rate stays UNfloored', () => {
    const leg = buildWhatIfCoastLeg({ fiTarget: 2_000_000, rate: 0.02, inflation: 0.05, yearsUntilRetirement: 25 });
    expect(leg.coastFmt).toBe('$2,000,000');
    expect(leg.realRateUnfloored).toBeLessThan(0);
  });
});
