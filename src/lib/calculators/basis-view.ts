import type { DollarBasis } from './dollar-basis';
import { pctFromFraction } from './scenario-assumptions';
// NOTE: until Task 8's D-T9 deletion, ChartDisplayMode still lives in the old
// hook module; Task 8 hoists it to real-mode.ts and rewires this import.
import type { ChartDisplayMode } from './use-chart-display-mode';

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
