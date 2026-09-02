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
