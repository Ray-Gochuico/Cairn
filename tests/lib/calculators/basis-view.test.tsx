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
} from '@/lib/calculators/basis-view';
import {
  apyToApr,
  compoundInterestSeries,
  type CompoundInterestInput,
} from '@/lib/compound-interest';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import {
  CALCULATORS_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { usePersonsStore } from '@/stores/persons-store';
import type { AppSettings } from '@/types/schema';

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
