import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  TODAY_PHRASE,
  TODAY_SUFFIX,
  FUTURE_SUFFIX,
  futurePhrase,
  basisPhrase,
  basisSuffix,
  chartModeFor,
  useCompoundBasisView,
  usePathToFiBasisView,
  PATH_TO_FI_BRIDGE,
  buildHistoryFanView,
  HISTORY_FAN_KEYS,
} from '@/lib/calculators/basis-view';
import type { HistoryFanResult } from '@/lib/history-fan';
import {
  apyToApr,
  compoundInterestSeries,
  type CompoundInterestInput,
} from '@/lib/compound-interest';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import {
  CALCULATORS_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import { formatCurrency } from '@/lib/format';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { usePersonsStore } from '@/stores/persons-store';
import { FilingStatus } from '@/types/enums';
import type { AppSettings, Household } from '@/types/schema';

describe('basis vocabulary (D-T4 copy contract)', () => {
  it('long-register pair', () => {
    expect(TODAY_PHRASE).toBe("in today's dollars");
    expect(futurePhrase(0.03)).toBe('in future dollars, at your 3% inflation assumption');
    expect(futurePhrase(0.024)).toBe('in future dollars, at your 2.4% inflation assumption');
    // pctFromFraction kills IEEE754 artifacts AND trailing zeros:
    expect(futurePhrase(0.0275)).toBe('in future dollars, at your 2.75% inflation assumption');
    expect(futurePhrase(0.07 - 0.04)).toBe('in future dollars, at your 3% inflation assumption');
  });

  it('F11 zero-inflation edge phrase', () => {
    expect(futurePhrase(0)).toBe(
      "in future dollars — at your 0% inflation assumption these equal today's dollars",
    );
  });

  it('short-register pair + dispatch helpers', () => {
    expect(TODAY_SUFFIX).toBe("(today's $)");
    expect(FUTURE_SUFFIX).toBe('(future $)');
    expect(basisSuffix('today')).toBe(TODAY_SUFFIX);
    expect(basisPhrase('today', 0.03)).toBe(TODAY_PHRASE);
    expect(basisPhrase('future', 0.03)).toBe(futurePhrase(0.03));
  });

  it('D-T10: the boundary owns the ONE engine mapping (today→REAL, future→NOMINAL)', () => {
    expect(chartModeFor('today')).toBe('REAL');
    expect(chartModeFor('future')).toBe('NOMINAL');
  });
});

describe('useCompoundBasisView (the conversion boundary, D-T5)', () => {
  const INPUT: CompoundInterestInput = {
    pv: 1000,
    monthlyContribution: 100,
    annualRate: apyToApr(0.07, 12),
    years: 10,
    frequency: 'MONTHLY',
  };

  beforeEach(() => {
    sessionStorage.clear();
    __resetScenarioAssumptionsForTests();
    __resetDollarBasisForTests();
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as AppSettings,
      isLoading: false,
      error: null,
    });
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  });

  it('today (default) maps to REAL: deflated literals, phrase, suffix, caption in ONE bundle', () => {
    const series = compoundInterestSeries(INPUT);
    const { result } = renderHook(() => useCompoundBasisView(INPUT, series));
    expect(result.current?.basis).toBe('today');
    expect(result.current?.fmt.headline).toBe('$14,899');
    expect(result.current?.fmt.finalBalance).toBe('$14,899');
    expect(result.current?.fmt.totalContributed).toBe('$11,622'); // per-period deflation, NOT $10,155
    expect(result.current?.phrase).toBe("in today's dollars");
    expect(result.current?.suffix).toBe("(today's $)");
    expect(result.current?.chartLabel).toBe("Balance over time (today's $)");
    // chart series deflated by each point's OWN elapsed years (yearKey discipline),
    // and ALL of low/mid/high deflate (P9 — no nominal residue in the data object):
    const last = result.current!.chartData[result.current!.chartData.length - 1];
    expect(last.mid).toBeCloseTo(series.finalMid / Math.pow(1.025, 10), 6);
    expect(last.low).toBeCloseTo(series.finalLow / Math.pow(1.025, 10), 6);
    expect(last.high).toBeCloseTo(series.finalHigh / Math.pow(1.025, 10), 6);
  });

  it('future maps to NOMINAL: raw engine output + the D-T4 future phrase', () => {
    const series = compoundInterestSeries(INPUT);
    const { result } = renderHook(() => useCompoundBasisView(INPUT, series));
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(result.current?.fmt.headline).toBe('$19,072');
    expect(result.current?.fmt.totalContributed).toBe('$13,000');
    expect(result.current?.phrase).toBe('in future dollars, at your 2.5% inflation assumption');
    expect(result.current?.suffix).toBe('(future $)');
    expect(result.current?.chartLabel).toBe('Balance over time (future $)');
    const last = result.current!.chartData[result.current!.chartData.length - 1];
    expect(last.mid).toBe(series.finalMid); // untouched nominal leg
  });

  it('zero-inflation passthrough: both bases identical, edge phrase renders (F11)', () => {
    sessionStorage.setItem(
      SCENARIO_STORAGE_KEY,
      JSON.stringify({ inflationPct: 0 }), // bar override → engine.inflation === 0, guaranteed path
    );
    const series = compoundInterestSeries(INPUT);
    const { result } = renderHook(() => useCompoundBasisView(INPUT, series));
    const todayHeadline = result.current?.fmt.headline;
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(result.current?.fmt.headline).toBe(todayHeadline);
    expect(result.current?.phrase).toBe(
      "in future dollars — at your 0% inflation assumption these equal today's dollars",
    );
  });

  it('null-safe: no input/series (years=0) → null bundle', () => {
    const { result } = renderHook(() => useCompoundBasisView(null, null));
    expect(result.current).toBeNull();
  });
});

describe('usePathToFiBasisView (the conversion boundary, D-T5)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetScenarioAssumptionsForTests();
    __resetCalcScopeForTests();
    __resetDollarBasisForTests();
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useHouseholdStore.setState({
      household: {
        filingStatus: FilingStatus.SINGLE,
        state: 'CA',
        city: null,
        monthlyExpenseBaseline: 5000,
        withdrawalRate: 0.04,
        inflationAssumption: 0.03,
        growthScenarios: [{ label: 'Moderate', rate: 0.06 }],
      } as Household,
      isLoading: false,
      error: null,
    });
    sessionStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({ portfolio: 200_000 }));
  });

  const FI = [{ label: 'Moderate', rate: 0.06, years: 28.5 }];
  const ARGS = {
    fiSeries: FI,
    mode: 'KEEP' as const,
    yearsUntilRetirement: 29,
    horizon: 30,
    targetFv: 1_500_000,
  };

  it('coast rows keep the H1 discipline: floored-real coast → the $452,380 gap, unfloored table rate', () => {
    const { result } = renderHook(() => usePathToFiBasisView(ARGS));
    const row = result.current!.coastRows[0];
    expect(row.realRate).toBeCloseTo(1.06 / 1.03 - 1, 10); // unfloored Fisher division
    expect(row.gapFmt).toBe('$452,380'); // NOT the $76,835 nominal solve
    expect(result.current!.fmt.targetFv).toBe('$1,500,000');
    expect(result.current!.fmt.monthlyExpenses).toBe('$5,000');
  });

  it('a return at/below inflation floors ONLY the coast solve: full target, $1,300,000 gap, table rate still negative', () => {
    // Review MAJOR-0 anchor. The 6% fixture above cannot separate floored from
    // unfloored (realRateOf === realRateOfUnfloored at 6%/3%); this one can.
    const { result } = renderHook(() =>
      usePathToFiBasisView({
        ...ARGS,
        fiSeries: [{ label: 'Moderate', rate: 0.02, years: Infinity }],
      }),
    );
    const row = result.current!.coastRows[0];
    // FLOORED coast (realRateOf clamps to 0): discounting at 0% real leaves the
    // FULL FI target standing — exactly what the card's floored note asserts.
    expect(row.coastNeededToday).toBe(1_500_000);
    expect(row.gapFmt).toBe('$1,300,000'); // 1,500,000 − 200,000
    // …while the TABLE rate stays UNFLOORED (and negative): 1.02/1.03 − 1.
    expect(row.realRate).toBeCloseTo(1.02 / 1.03 - 1, 10);
    expect(row.realRate).toBeLessThan(0);
    // Anti-pin — the unfloored coast solve, 1.5M/(1.02/1.03)^29 = $1,990,517
    // (gap $1,790,517): a figure that would contradict the note beside it.
    expect(formatCurrency(row.coastNeededToday)).not.toBe('$1,990,517');
    expect(row.gapFmt).not.toBe('$1,790,517');
  });

  it('today: flat REAL target; future: target grows by 1.03^t — the wiring the render sweep cannot see', () => {
    const { result } = renderHook(() => usePathToFiBasisView(ARGS));
    const data = result.current!.chartData;
    expect(data).toHaveLength(31);
    expect(data[0].target).toBeCloseTo(1_500_000, 6);
    expect(data[30].target).toBeCloseTo(1_500_000, 6); // REAL view: flat at targetFv
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    const grown = result.current!.chartData;
    expect(grown[0].target).toBeCloseTo(1_500_000, 6);
    expect(grown[30].target).toBeCloseTo(1_500_000 * Math.pow(1.03, 30), 4); // NOMINAL view: grown target
  });

  it('teaching bridge exists ONLY in Future mode; captions flip; coast rows are basis-invariant', () => {
    const { result } = renderHook(() => usePathToFiBasisView(ARGS));
    expect(result.current!.teachingBridge).toBeNull();
    expect(result.current!.chartLabel).toBe("Path to FI (today's $)");
    const todayGap = result.current!.coastRows[0].gapFmt;
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(result.current!.teachingBridge).toBe(PATH_TO_FI_BRIDGE);
    expect(result.current!.chartLabel).toBe('Path to FI (future $)');
    expect(result.current!.coastRows[0].gapFmt).toBe(todayGap); // year-0 figure: invariant
  });

  it('the inflation wire is the RESOLVER, not a 3% constant (non-3% fixture moves rate, gap, phrase and target)', () => {
    // Every other PathToFi fixture in W5 seeds 3%, so a hardcoded
    // `const inflation = 0.03` inside the hook would be indistinguishable.
    useHouseholdStore.setState({
      household: {
        ...(useHouseholdStore.getState().household as Household),
        inflationAssumption: 0.024,
      },
      isLoading: false,
      error: null,
    });
    __resetScenarioAssumptionsForTests();
    const { result } = renderHook(() => usePathToFiBasisView(ARGS));
    const row = result.current!.coastRows[0];
    expect(row.realRate).toBeCloseTo(1.06 / 1.024 - 1, 10); // 3.515625% real, NOT 2.9126%
    expect(row.gapFmt).toBe('$350,706'); // 1.5M/1.03515625^29 − 200k, NOT $452,380
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(result.current!.phrase).toBe('in future dollars, at your 2.4% inflation assumption');
    expect(result.current!.chartData[30].target).toBeCloseTo(1_500_000 * Math.pow(1.024, 30), 4);
  });

  it('STOP at/past retirement (horizon 0) → empty chart, rows still computed; null fiSeries → null', () => {
    const { result } = renderHook(() => usePathToFiBasisView({ ...ARGS, mode: 'STOP', horizon: 0 }));
    expect(result.current!.chartData).toEqual([]);
    expect(result.current!.coastRows).toHaveLength(1);
    const { result: nul } = renderHook(() => usePathToFiBasisView({ ...ARGS, fiSeries: null }));
    expect(nul.current).toBeNull();
  });
});

/* ── W2 D-UB13: the additive PINNED arm (History fan view bundle) ────────── */

describe('buildHistoryFanView (W2 pinned arm)', () => {
  const RESULT: HistoryFanResult = {
    horizonYears: 3,
    m: 4,
    startYears: { first: 2001, last: 2004 },
    byYear: { p25: [1000, 1075, 1236, 1373], p50: [1000, 1150, 1278, 1458], p75: [1000, 1225, 1325, 1530] },
    holds: { count: 3, target: 1400 },
  };

  it('encodes the delta stack: fan2575 === p75 − p25 per row; year-0 floor === round(pv)', () => {
    const v = buildHistoryFanView(RESULT, { xLabel: 'numeric' });
    expect(v.chartData).toHaveLength(4);
    v.chartData.forEach((row, k) => {
      expect(row.fanFloor).toBe(RESULT.byYear.p25[k]);
      expect(row.fan2575).toBe(RESULT.byYear.p75[k] - RESULT.byYear.p25[k]);
      expect(row.p50).toBe(RESULT.byYear.p50[k]);
      expect(row.target).toBe(1400);
    });
    expect(v.chartData[0].fanFloor).toBe(1000); // the pv anchor
  });

  it('numeric vs year-word x labels (the m2 axis rule)', () => {
    expect(buildHistoryFanView(RESULT, { xLabel: 'numeric' }).chartData.map((r) => r.year)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(
      buildHistoryFanView(RESULT, { xLabel: 'year-word' }).chartData.map((r) => r.year),
    ).toEqual(['Year 0', 'Year 1', 'Year 2', 'Year 3']);
  });

  it('crossing is the FIRST year p50 ≥ target (year 0 counts)', () => {
    expect(buildHistoryFanView(RESULT, { xLabel: 'numeric' }).crossing).toEqual({
      year: 3,
      value: 1400,
    });
    const pvAlreadyThere: HistoryFanResult = {
      ...RESULT,
      holds: { count: 4, target: 500 },
    };
    expect(buildHistoryFanView(pvAlreadyThere, { xLabel: 'numeric' }).crossing).toEqual({
      year: 0,
      value: 500,
    });
    const never: HistoryFanResult = { ...RESULT, holds: { count: 0, target: 9_999 } };
    expect(buildHistoryFanView(never, { xLabel: 'numeric' }).crossing).toBeNull();
  });

  it('no target ⇒ no crossing and no target key on any row', () => {
    const v = buildHistoryFanView({ ...RESULT, holds: null }, { xLabel: 'year-word' });
    expect(v.crossing).toBeNull();
    expect(v.holds).toBeNull();
    for (const row of v.chartData) expect('target' in row).toBe(false);
  });

  it('PINNED: today register, referentially W5’s constants — never a retyped literal', () => {
    const v = buildHistoryFanView(RESULT, { xLabel: 'numeric' });
    expect(v.pinnedBasis).toBe('today');
    expect(v.phrase).toBe(TODAY_PHRASE);
    expect(v.suffix).toBe(TODAY_SUFFIX);
    expect(v.m).toBe(4);
    expect(v.horizonYears).toBe(3);
  });

  it('the fan keys are a stable module constant (recharts re-render discipline)', () => {
    expect(HISTORY_FAN_KEYS).toEqual({ floorKey: 'fanFloor', deltaKey: 'fan2575' });
    expect(HISTORY_FAN_KEYS).toBe(HISTORY_FAN_KEYS);
  });

  it('the empty engine shape encodes to an empty chart (the degradation branches own it)', () => {
    const v = buildHistoryFanView(
      { horizonYears: 160, m: 0, startYears: null, byYear: { p25: [], p50: [], p75: [] }, holds: null },
      { xLabel: 'numeric' },
    );
    expect(v.chartData).toEqual([]);
    expect(v.crossing).toBeNull();
    expect(v.m).toBe(0);
  });
});
