import { TODAY_SUFFIX } from './basis-view';

/**
 * W2 copy contract (CH-1…CH-9) — byte-exact builders for every History-view
 * string. Register: mechanical counts, pointwise band framing ("at each year",
 * never a traced path); the words are stretches / count / middle half /
 * history. The forbidden-register guard in
 * tests/lib/calculators/history-fan-copy.test.ts names the vocabulary this
 * file must stay clear of — "not a probability" is the one sanctioned
 * negation. Em dash U+2014 between clauses; en dash U+2013 in ranges.
 */
const years = (n: number) => (n === 1 ? 'year' : 'years');

// CH-1
export function holdsLineKeep(a: { H: number; J: number; M: number }): string {
  return `Reached the target within ${a.H} ${years(a.H)} in ${a.J} of the ${a.M} full ${a.H}-year stretches since 1871 — a count of past stretches, not a probability.`;
}
// CH-2 — the STOP variant names the zero-contribution premise.
export function holdsLineStop(a: { H: number; J: number; M: number }): string {
  return `Reached the target within ${a.H} ${years(a.H)} without further contributions in ${a.J} of the ${a.M} full ${a.H}-year stretches since 1871 — a count of past stretches, not a probability.`;
}
// CH-3 — ONE string, both cards; pointwise by construction (spec m10).
export function fanCaption(a: { M: number; H: number }): string {
  return `At each year, the shaded band spans the middle half (25th–75th) of the balances the ${a.M} full ${a.H}-year stretches in the bundled U.S. dataset (1871–2022) had reached by that year; the line is the per-year median, not any single stretch's path. 75% stocks / 25% bonds, rebalanced yearly, gross of fees · today's dollars, in both page views · history, not a forecast.`;
}
// CH-4
export const COMPOUND_CADENCE_CAPTION =
  'History compounds annually at real (CPI-adjusted) historical returns — the frequency and variance knobs apply to the assumed view.';
// CH-5 (spec ⚑F5 degradation)
export function tooFewStretchesLine(a: { M: number; H: number }): string {
  const verb = a.M === 1 ? 'stretch exists' : 'stretches exist';
  return `Only ${a.M} full ${a.H}-year ${verb} in the 1871–2022 data — too few to draw a meaningful middle half.`;
}
// CH-6
export function noStretchLine(a: { H: number }): string {
  return `No full ${a.H}-year stretch exists in the 1871–2022 data.`;
}
// CH-7
export const RETURN_SOURCE_GROUP_LABEL = 'Return source';
export const RETURN_SOURCE_ASSUMED_LABEL = 'Assumed';
export const RETURN_SOURCE_HISTORY_LABEL = 'History';
// CH-8 (coordinator ruling 2026-09-02, the CH-10 collision): the parenthetical
// is W5's LANDED today suffix, imported — the pinned register is referentially
// W5's, never a retyped literal.
export const HISTORY_CHART_LABEL_PATH_TO_FI = `Path to FI — history ${TODAY_SUFFIX}`;
export const HISTORY_CHART_LABEL_COMPOUND = `Balance over time — history ${TODAY_SUFFIX}`;
// CH-9 — verbatim from the Backtest bands legend (BacktestChart.tsx).
export const FAN_LEGEND_BAND = '25th–75th percentile';
export const FAN_LEGEND_MEDIAN = 'Median (p50)';
