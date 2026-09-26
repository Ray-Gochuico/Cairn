import { renderHook, act, render, screen } from '@testing-library/react';
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
import { detectMilestones, emptyLeverPayload, type Milestones, type MonthlyState } from '@/lib/scenarios';
import { DecomposedTooltipContent } from '@/components/whatif/ProjectionTooltip';
import type { Scenario } from '@/types/scenario';

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
// A-3a: the engine stamps the horizon state's elapsed months beside netWorth30y
// (milestones.ts) — 359 at the 30-year mark of a 360-month projection.
const MILESTONES = new Map<number, Milestones>([
  [1, { netWorth30y: 2_345_000, netWorth30yElapsedMonths: 359, debtFreeISO: '2029-06' }],
  [2, { netWorth30y: 2_550_000, netWorth30yElapsedMonths: 359 }],
  [3, {}],
]);
const ARGS = { projections: PROJECTIONS, milestones: MILESTONES, inflation: 0.025, startISO: '2026-01' };

describe('useWhatIfBasisView — the What-If arm of the ONE boundary (D-W51-1)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it("today (default, D-T3): each month deflated by its OWN elapsed years; milestones by 1.025^(359/12) — the horizon state's own elapsed years (A-3a); suffix + caption", () => {
    const { result } = renderHook(() => useWhatIfBasisView(ARGS));
    const v = result.current;
    expect(v.basis).toBe('today');
    const rows = v.displayProjections.get(1)!;
    expect(rows[0].netWorth).toBe(100_000); //                     year 0 — identity
    expect(rows[1].netWorth).toBeCloseTo(195_121.9512195122, 6); // 200,000 / 1.025
    expect(rows[2].netWorth).toBeCloseTo(282_040.5748910191, 6); //  300,000 / 1.025^2.5
    expect(v.displayProjections.get(1)).not.toBe(PROJECTIONS.get(1)); // NEW arrays — the engine cache is never mutated
    expect(v.netWorth30yFmt.get(1)).toBe('$1,120,264'); // 2,345,000 / 1.025^(359/12) = 2,345,000 / 2.093255814832335
    expect(v.netWorth30yFmt.get(2)).toBe('$1,218,198'); // 2,550,000 / 2.093255814832335 = 1,218,197.98
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
    expect(result.current.netWorth30yFmt.get(1)).toBe('$1,120,264');
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
    expect(v.netWorth30yFmt.get(1)).toBe('$1,120,264'); //    2,345,000 / 1.025^(359/12) — deflated…
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
  it("today divides by (1+i)^(elapsed/12) of the horizon state actually read — 359 months at the 30-year mark, 275 on a 23-year horizon (A-3a, CR-A3-2)", () => {
    const at30 = toDisplayMilestones(new Map([[1, { netWorth30y: 900_000, netWorth30yElapsedMonths: 359, debtFreeISO: '2029-06' }]]), 'today', 0.03).get(1)!;
    expect(at30.netWorth30y).toBeCloseTo(371_702.54700674076, 6); // 900,000 / 1.03^(359/12) = 900,000 / 2.4212909145970385
    expect(at30.debtFreeISO).toBe('2029-06');
    expect(at30.basis).toBe('today');
    const at23 = toDisplayMilestones(new Map([[1, { netWorth30y: 900_000, netWorth30yElapsedMonths: 275 }]]), 'today', 0.03).get(1)!;
    expect(at23.netWorth30y).toBeCloseTo(457_147.24827544985, 6); // 900,000 / 1.03^(275/12) = 900,000 / 1.9687310891516367
  });

  it("a milestone that states no horizon month states no Today's figure — the recipe never guesses an exponent; Future still passes the figure through (A-3a)", () => {
    const unstamped = new Map<number, Milestones>([[1, { netWorth30y: 900_000 }]]);
    expect(toDisplayMilestones(unstamped, 'today', 0.03).get(1)!.netWorth30y).toBeUndefined();
    expect(toDisplayMilestones(unstamped, 'future', 0.03).get(1)!.netWorth30y).toBe(900_000);
  });

  it('future is identity + the brand; undefined stays undefined (never a fake $0)', () => {
    const out = toDisplayMilestones(new Map([[1, { netWorth30y: 900_000 }], [2, {}]]), 'future', 0.03);
    expect(out.get(1)!.netWorth30y).toBe(900_000);
    expect(out.get(2)!.netWorth30y).toBeUndefined();
    expect(out.get(2)!.basis).toBe('future');
  });
});

// v1.8.0 A-3a — the m4 manual law (B1 smoke item 5; b1-review-findings MINOR 0), pinned:
// the chart tooltip's Net worth at the state the scoreboard reads equals the
// scoreboard to the dollar in BOTH bases. The two figures are the SAME double:
// toDisplayMilestones deflates by the horizon state's own elapsed months with
// toReal's own expression. At horizons of 30 years or less that state is the
// chart's terminal month; at 40 years it is the 30-year mark (index 359).
describe('the m4 law — tooltip Net worth at the horizon state = the scoreboard, to the dollar, both bases (A-3a)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  /** n consecutive engine months from 2026-05, net worth 80,000 + 5,000·i (engine.ts addMonths shape).
   *  80,000 is chosen so `nw * (1 / p)` and `nw / p` differ in the last bit at BOTH horizon
   *  states below — the exact-double assertion then proves toReal's own expression. */
  const engineRun = (n: number): MonthlyState[] =>
    Array.from({ length: n }, (_, i) =>
      st(`${2026 + Math.floor((4 + i) / 12)}-${String(((4 + i) % 12) + 1).padStart(2, '0')}`, 80_000 + 5_000 * i));
  const baseline = {
    id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid', visible: true,
    isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(), createdAt: '', updatedAt: '',
  } as Scenario;
  /** The tooltip's "Net worth: $X" for scenario 1 at `monthISO`, read off the real tooltip component. */
  const tooltipNetWorth = (displayProjections: Map<number, MonthlyState[]>, monthISO: string): string => {
    const { unmount } = render(
      <DecomposedTooltipContent label={monthISO} active scenarios={[baseline]} displayProjections={displayProjections} />,
    );
    const text = screen.getByTestId('whatif-projection-tooltip-scenario-1').textContent ?? '';
    unmount();
    return /Net worth: ([−-]?\$[\d,]+)/.exec(text)![1];
  };

  it.each([
    // [months, horizon index, today figure, the retired fixed-30 figure]
    [360, 359, '$895,734', '$893,893'], // 1,875,000 / 1.025^(359/12) = 1,875,000 / 2.093255814832335 = 895,733.81 ; ÷ 1.025^30 = $893,893
    [276, 275, '$826,243', '$693,661'], // 1,455,000 / 1.025^(275/12) = 1,455,000 / 1.7609833451546588 = 826,242.91 ; ÷ 1.025^30 = $693,661
    [480, 359, '$895,734', '$893,893'], // the 30-year mark, NOT the terminal month (index 479 reads $923,664)
  ])('%i months: the tooltip at index %i reads the scoreboard figure %s in Today; nominal in Future', (n, h, todayFig, retired) => {
    const projections = new Map<number, MonthlyState[]>([[1, engineRun(n)]]);
    const milestones = new Map<number, Milestones>([[1, detectMilestones(projections.get(1)!, { withdrawalRate: 0.04 })]]);
    const { result } = renderHook(() =>
      useWhatIfBasisView({ projections, milestones, inflation: 0.025, startISO: '2026-05' }));
    const label = projections.get(1)![h].monthISO;

    // Today's $ (the default): one double, one string.
    let v = result.current;
    expect(v.displayMilestones.get(1)!.netWorth30y).toBe(v.displayProjections.get(1)![h].netWorth);
    expect(v.netWorth30yFmt.get(1)).toBe(todayFig);
    expect(tooltipNetWorth(v.displayProjections, label)).toBe(todayFig);
    expect(v.netWorth30yFmt.get(1)).not.toBe(retired);

    // Future $: both read the engine's nominal state.
    act(() => useDollarBasisStore.getState().setBasis(WHATIF_PAGE_ID, 'future'));
    v = result.current;
    expect(v.netWorth30yFmt.get(1)).toBe(tooltipNetWorth(v.displayProjections, label));
    expect(v.netWorth30yFmt.get(1)).toBe(`$${(80_000 + 5_000 * h).toLocaleString('en-US')}`);
  });

  it('40 years: the terminal month is NOT the scoreboard figure — the scoreboard reads the 30-year mark', () => {
    const projections = new Map<number, MonthlyState[]>([[1, engineRun(480)]]);
    const milestones = new Map<number, Milestones>([[1, detectMilestones(projections.get(1)!, { withdrawalRate: 0.04 })]]);
    const { result } = renderHook(() =>
      useWhatIfBasisView({ projections, milestones, inflation: 0.025, startISO: '2026-05' }));
    // 2,475,000 / 1.025^(479/12) = 2,475,000 / 2.6795444156160224 = 923,664.48 → $923,664
    expect(tooltipNetWorth(result.current.displayProjections, projections.get(1)![479].monthISO)).toBe('$923,664');
    expect(result.current.netWorth30yFmt.get(1)).toBe('$895,734');
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
