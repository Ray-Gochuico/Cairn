import type { DollarBasis } from './dollar-basis';
import { pctFromFraction } from './scenario-assumptions';

/* ── D-T4 vocabulary — the ONLY place basis phrases are authored. Pure (no
      hooks, no stores) so store-free libs such as plan-review.ts can import
      it without dragging the boundary's hook graph in (W5.1 D-W51-10).
      basis-view.ts RE-EXPORTS every symbol: W2's and W5's import sites stay
      referentially identical (CH-10). ───────────────────────────────────── */

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

/** Short register (tile labels / chart captions / table cells). */
export const TODAY_SUFFIX = "(today's $)";
export const FUTURE_SUFFIX = '(future $)';

export function basisPhrase(basis: DollarBasis, inflation: number): string {
  return basis === 'today' ? TODAY_PHRASE : futurePhrase(inflation);
}
export function basisSuffix(basis: DollarBasis): string {
  return basis === 'today' ? TODAY_SUFFIX : FUTURE_SUFFIX;
}
