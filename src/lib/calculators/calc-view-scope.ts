import { clearEarnerPicks } from './use-selected-earner';

/**
 * Wave B: the calculators page scope — "which person is this page about".
 * A module-level external store (the useSalaryOverrides idiom) rather than a
 * direct useViewFilter read, for two load-bearing reasons (D-B10):
 *   1. Router-free consumers — useScenarioAssumptions and the cards subscribe
 *      from outside any Router context (bare card tests included).
 *   2. Joint coercion (D-B2) — ?view=joint means nothing to tax/solve cards;
 *      the bridge maps it to household exactly once, before it gets here.
 * The URL stays the single source of truth: useCalcScopeUrlSync (mounted by
 * CalculatorsLayout and the Backtest page) mirrors ?view= into this store.
 * Scope is a LENS (owner constraint 1): nothing here touches isOverridden,
 * editedCount, or any persisted user data — only the calc-earner:* picks,
 * which are view state by contract.
 */
let scopePersonId: number | null = null;
const listeners = new Set<() => void>();

export function getCalcScopePersonId(): number | null {
  return scopePersonId;
}

export function subscribeCalcScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mirror the URL scope. A REAL change clears the per-card earner picks so
 *  the broadcast wins (precedence rule 2, D-B9); a no-op sync touches nothing. */
export function syncCalcScope(next: number | null): void {
  if (next === scopePersonId) return;
  scopePersonId = next;
  clearEarnerPicks();
  listeners.forEach((l) => l());
}

/** Test seam: reset the mirror + listeners between tests. */
export function __resetCalcScopeForTests(): void {
  scopePersonId = null;
  listeners.clear();
}
