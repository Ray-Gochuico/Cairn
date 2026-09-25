import type { LeverPayload } from './lever-types';
import type { RealState } from './state-snapshot';

/** RealState.expenseBasis — captured once at projection start (state-snapshot.ts). */
export type ExpenseBasis = RealState['expenseBasis'];

/**
 * C2 — the ONE resolution of a scenario's recurring monthly expense base: the
 * engine's expense seam (engine.ts). The What-If FI gate and the gaps register
 * (G11) read the engine's per-month stamp built on it
 * (MonthlyState.authoredExpenses = base + that month's periods, obligations
 * excluded) — C2 review: never a month-0 figure resolved beside the engine.
 * Extracted verbatim from the engine (2026-09-24): custom → customMonthly verbatim;
 * data modes → the figure pre-computed on RealState.expenseBasis at capture.
 * `?? 0` keeps legacy fixtures that pre-date expenseBasis, hand-built payloads
 * without the Feature-B keys, and the back-compat custom/0 schema default at a
 * 0 base — byte-identical to the pre-Feature-B engine. A data mode with
 * nothing captured resolves to 0 HERE and is SAID by the popover's empty-data
 * guard and the G11 row — never substituted (design OD3).
 */
export function resolveExpenseBase(
  payload: LeverPayload,
  expenseBasis: ExpenseBasis | undefined,
): number {
  const source =
    (payload as { expenseSource?: LeverPayload['expenseSource'] }).expenseSource ?? 'custom';
  return source === 'custom'
    ? ((payload as { customMonthly?: number }).customMonthly ?? 0)
    : (expenseBasis?.[source] ?? 0);
}
