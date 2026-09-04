import { useMemo } from 'react';
import type { DollarBasis } from './dollar-basis';
import { CALCULATORS_PAGE_ID, useDollarBasis } from './dollar-basis';
import { pctFromFraction } from './scenario-assumptions';
import { useScenarioAssumptions } from './use-scenario-assumptions';
import { toRealSeries } from './real-mode';
import { realRateOf, realRateOfUnfloored } from './real-rate';
import { buildProjectionChartData } from './projection-chart';
import {
  toRealSummary,
  type CompoundInterestInput,
  type CompoundInterestSeries,
} from '@/lib/compound-interest';
import { coastFi } from '@/lib/coast-fi';
import { formatCurrency, formatSignedCurrency } from '@/lib/format';
import type { ChartDisplayMode } from './real-mode';
import type { HistoryFanResult } from '@/lib/history-fan';

/* ── D-T4 vocabulary — the ONLY place basis phrases are authored ────────── */

/** Long register (headline-adjacent). */
export const TODAY_PHRASE = "in today's dollars";
export function futurePhrase(inflation: number): string {
  const pct = pctFromFraction(inflation);
  if (pct === 0) {
    // F11 edge: with 0% inflation both bases are numerically identical — say so.
    return "in future dollars — at your 0% inflation assumption these equal today's dollars";
  }
  return `in future dollars, at your ${pct}% inflation assumption`;
}

/** Short register (tile labels / chart captions). */
export const TODAY_SUFFIX = "(today's $)";
export const FUTURE_SUFFIX = '(future $)';

export function basisPhrase(basis: DollarBasis, inflation: number): string {
  return basis === 'today' ? TODAY_PHRASE : futurePhrase(inflation);
}
export function basisSuffix(basis: DollarBasis): string {
  return basis === 'today' ? TODAY_SUFFIX : FUTURE_SUFFIX;
}

/** D-T10: the boundary owns the single mapping into the untouched engines. */
export function chartModeFor(basis: DollarBasis): ChartDisplayMode {
  return basis === 'today' ? 'REAL' : 'NOMINAL';
}

/* ── Registration contract — FROZEN for W2 (§ spec merge-train ruling).
      Changing these shapes after W5 merges is a breaking-change review. ──── */

export type FigureClass = 'convertible' | 'invariant' | 'pinned';

export interface RegisteredFigure {
  testId: string;
  cls: FigureClass;
  /** REQUIRED iff cls === 'pinned' (the figure's true, fixed basis). */
  pinnedBasis?: DollarBasis;
}

export interface RegisteredChart {
  chartTestId: string;
  captionTestId: string;
  cls: 'convertible' | 'pinned';
  pinnedBasis?: DollarBasis;
}

/** The per-surface bundle base shape (D-T5): values + phrase travel together. */
export interface BasisView {
  basis: DollarBasis;
  phrase: string;
  suffix: string;
  fmt: Record<string, string>;
  chartData?: Array<Record<string, number | string>>;
}

/* ── Compound surface ───────────────────────────────────────────────────── */

export interface CompoundBasisView extends BasisView {
  fmt: {
    headline: string;
    totalContributed: string;
    totalInterest: string;
    finalBalance: string;
  };
  chartData: Array<Record<string, number | string>>;
  chartLabel: string;
}

/**
 * THE Compound conversion boundary (D-T5): the only place a raw Compound
 * series may meet the active basis. Reads the SAME resolver output the card
 * fed the engine (useScenarioAssumptions → engine.inflation), so the {i}% in
 * the phrase is pctFromFraction of the number actually divided by — a
 * phrase/math mismatch is unrepresentable.
 */
export function useCompoundBasisView(
  input: CompoundInterestInput | null,
  series: CompoundInterestSeries | null,
): CompoundBasisView | null {
  const { engine } = useScenarioAssumptions();
  const inflation = engine.inflation;
  const [basis] = useDollarBasis(CALCULATORS_PAGE_ID);
  return useMemo(() => {
    if (!input || !series) return null;
    const summary = basis === 'today' ? toRealSummary(input, series, inflation) : series;
    const base = series.yearly.map((y) => ({
      year: `Year ${y.year}`,
      yearNum: y.year,
      mid: y.mid,
      low: y.low,
      high: y.high,
    }));
    // Deflate ALL three keys, not just the visible ones (P9): no nominal
    // residue may survive in the data object — the blend-bug class.
    const chartData =
      basis === 'today'
        ? toRealSeries(base, inflation, { valueKeys: ['low', 'mid', 'high'], yearKey: 'yearNum' })
        : base;
    const suffix = basisSuffix(basis);
    return {
      basis,
      phrase: basisPhrase(basis, inflation),
      suffix,
      fmt: {
        headline: formatCurrency(summary.finalMid),
        totalContributed: formatCurrency(summary.totalContributed),
        totalInterest: formatCurrency(summary.totalInterestMid),
        finalBalance: formatCurrency(summary.finalMid),
      },
      chartData,
      chartLabel: `Balance over time ${suffix}`,
    };
  }, [input, series, basis, inflation]);
}

/* ── PathToFi surface ───────────────────────────────────────────────────── */

/** C13 — the pinned FI target's Future-mode bridge clause. */
export const PATH_TO_FI_BRIDGE =
  'The target line on the chart grows with inflation so it buys the same retirement in future dollars.';

export interface PathToFiCoastRow {
  label: string;
  rate: number;
  /** UNFLOORED Fisher real rate — the table's "≈ x% real" cell. */
  realRate: number;
  /** Year-0 figure (invariant by definition). */
  coastNeededToday: number;
  /** Signed gap vs the scoped portfolio — invariant, pre-formatted (P13). */
  gapFmt: string;
}

export interface PathToFiBasisView extends BasisView {
  fmt: { targetFv: string; monthlyExpenses: string };
  scopeExclusionsFmt: { jointPortfolio: string; unattributedContribution: string } | null;
  chartData: Record<string, number>[];
  chartLabel: string;
  /** Future mode only — the pinned teaching line's bridge clause (C13). */
  teachingBridge: string | null;
  coastRows: PathToFiCoastRow[];
}

/**
 * THE PathToFi conversion boundary. Owns everything the card used to compute
 * with restricted converters: the coast rows (floored-real coast, unfloored
 * table rate — the H1 edge semantics, unchanged) and the projection chart
 * data (displayMode mapped from the page basis, D-T10). The years-to-FI
 * solves stay in the card (financialIndependenceSeries is engine, not
 * converter) and are basis-independent — the goalpost law.
 */
export function usePathToFiBasisView(args: {
  fiSeries: ReadonlyArray<{ label: string; rate: number; years: number }> | null;
  mode: 'KEEP' | 'STOP';
  yearsUntilRetirement: number;
  /** Card-computed chart horizon; < 1 → no chart rows. */
  horizon: number;
  targetFv: number;
}): PathToFiBasisView | null {
  const { engine, scopeExclusions } = useScenarioAssumptions();
  const inflation = engine.inflation;
  const [basis] = useDollarBasis(CALCULATORS_PAGE_ID);
  const { fiSeries, mode, yearsUntilRetirement, horizon, targetFv } = args;
  return useMemo(() => {
    if (!fiSeries) return null;
    const coastRows: PathToFiCoastRow[] = fiSeries.map((s) => {
      const coastNeededToday = coastFi({
        requiredAtRetirement: targetFv,
        annualRate: realRateOf(s.rate, inflation), // FLOORED (CoastFI edge semantics)
        yearsUntilRetirement,
      });
      return {
        label: s.label,
        rate: s.rate,
        realRate: realRateOfUnfloored(s.rate, inflation),
        coastNeededToday,
        gapFmt: formatSignedCurrency(coastNeededToday - engine.portfolio),
      };
    });
    const chartData =
      horizon >= 1
        ? buildProjectionChartData({
            pv: engine.portfolio,
            annualContribution: mode === 'KEEP' ? engine.annualContribution : 0,
            targetFv,
            scenarios: fiSeries,
            inflation,
            displayMode: chartModeFor(basis),
            horizon,
          })
        : [];
    const suffix = basisSuffix(basis);
    return {
      basis,
      phrase: basisPhrase(basis, inflation),
      suffix,
      fmt: {
        targetFv: formatCurrency(targetFv),
        monthlyExpenses: formatCurrency(engine.monthlyExpenses),
      },
      scopeExclusionsFmt: scopeExclusions
        ? {
            jointPortfolio: formatCurrency(scopeExclusions.jointPortfolio),
            unattributedContribution: formatCurrency(scopeExclusions.unattributedContribution),
          }
        : null,
      chartData,
      chartLabel: `Path to FI ${suffix}`,
      teachingBridge: basis === 'future' ? PATH_TO_FI_BRIDGE : null,
      coastRows,
    };
  }, [
    fiSeries,
    mode,
    yearsUntilRetirement,
    horizon,
    targetFv,
    basis,
    inflation,
    engine.portfolio,
    engine.annualContribution,
    engine.monthlyExpenses,
    scopeExclusions,
  ]);
}

/* ── W2 additive pinned arm (D-UB13) — the History fan's view bundle ──────
      PINNED today's dollars: identical values in BOTH page bases; never reads
      the active basis; historical data is NEVER re-inflated (no code path
      exists that could combine the fan with the future-mode inflator). The
      today-register constants are the ones authored ABOVE in this file, so
      the pinned phrase/suffix are referentially W5's (CH-10). ───────────── */

/** Stable-identity fan keys for InlineChart (recharts re-render discipline). */
export const HISTORY_FAN_KEYS = { floorKey: 'fanFloor', deltaKey: 'fan2575' } as const;

export interface HistoryFanView {
  /** Pinned-basis marker — matches the registry's `pinnedBasis` contract. */
  pinnedBasis: 'today';
  /** CH-10: this file's today-register phrase, verbatim. */
  phrase: string;
  /** CH-10: this file's today-register suffix, verbatim. */
  suffix: string;
  m: number;
  horizonYears: number;
  /** Rows k = 0…H: { year, fanFloor: p25, fan2575: p75−p25, p50, target? }. */
  chartData: Array<Record<string, number | string>>;
  holds: { count: number; target: number } | null;
  /** First year with p50 ≥ target (year 0 counts); null without a target. */
  crossing: { year: number; value: number } | null;
}

/**
 * Pure encoder from the engine result to the delta-stack chart rows — the one
 * place History values become renderable (no card-local transform may
 * re-derive dollars downstream of this bundle).
 * `xLabel`: 'numeric' (PathToFi, numeric year axis) or 'year-word' (Compound,
 * "Year 0"… labels — the m2 axis rule).
 */
export function buildHistoryFanView(
  result: HistoryFanResult,
  opts: { xLabel: 'numeric' | 'year-word' },
): HistoryFanView {
  const { p25, p50, p75 } = result.byYear;
  const target = result.holds?.target ?? null;
  const chartData = p25.map((floor, k) => ({
    year: opts.xLabel === 'numeric' ? k : `Year ${k}`,
    fanFloor: floor,
    fan2575: p75[k] - floor,
    p50: p50[k],
    ...(target != null ? { target: Math.round(target) } : {}),
  }));
  let crossing: HistoryFanView['crossing'] = null;
  if (target != null) {
    const k = p50.findIndex((v) => v >= target);
    if (k !== -1) crossing = { year: k, value: Math.round(target) };
  }
  return {
    pinnedBasis: 'today',
    phrase: TODAY_PHRASE,
    suffix: TODAY_SUFFIX,
    m: result.m,
    horizonYears: result.horizonYears,
    chartData,
    holds: result.holds,
    crossing,
  };
}
