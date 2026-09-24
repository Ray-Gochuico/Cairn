/**
 * B3 (v1.7.0, chip task_c681224b item 2): the nothing-invested register shared
 * by Path to FI (KEEP mode) and Earliest Retirement. With no portfolio and no
 * contributions every years-to-FI solve is Infinity and the solver's verdict
 * is `never-real`, and both cards used to answer with the Wave-17 rate lock
 * ("Returns at or below inflation — …") — parity-correct, copy-wrong: the
 * return rate is not the reason. This is the fresh-household default (persons
 * and scenarios entered, no snapshots or contributions yet), so it is the first
 * sentence many households read on those two cards.
 *
 * The predicate is checked BEFORE the lock on both cards; the sentence is ONE
 * constant so the two cards cannot drift (a cross-card parity test renders
 * both on one bar). Card-level on purpose: RetirementVerdict is unchanged, so
 * the interview's market_stress mapping (R4) needs no new row. Pure: no
 * store, no clock, no converter.
 */
export const NOTHING_INVESTED_LINE =
  'Nothing invested — the portfolio and contributions in the scenario bar above are both zero, so the target is never reached.';

/** Both engine inputs at or below zero (the bar clamps both at 0; the FI-eligible portfolio is never negative). */
export function nothingInvested(portfolio: number, annualContribution: number): boolean {
  return portfolio <= 0 && annualContribution <= 0;
}
