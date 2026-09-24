import type { LeverPayload } from './lever-types';
import type { RealState } from './state-snapshot';
import { monthlyExpenseFromPeriods } from './apply-real';

/** RealState.expenseBasis — captured once at projection start (state-snapshot.ts). */
export type ExpenseBasis = RealState['expenseBasis'];

/**
 * C2 — the ONE resolution of a scenario's recurring monthly expense base,
 * shared by the engine (engine.ts, the expense seam), the What-If page (the
 * per-scenario FI milestone gate) and the gaps register (G11). Extracted
 * verbatim from the engine (2026-09-24): custom → customMonthly verbatim;
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

/**
 * C2 — the scenario's AUTHORED monthly expense for one month: the resolved
 * base plus the expense periods active in that month. The household's
 * recurring obligations (rent, leases) are NOT included: the engine adds them
 * on top, and they are exactly what a $0-authored scenario would otherwise be
 * "FI" against (the false-FI hazard this wave closes). Periods count because
 * a pre-Feature-B scenario encodes its ENTIRE expense in them with a custom/0
 * base (the B5 back-compat contract, lever-types.ts).
 */
export function authoredMonthlyExpense(
  payload: LeverPayload,
  expenseBasis: ExpenseBasis | undefined,
  monthISO: string,
): number {
  return (
    resolveExpenseBase(payload, expenseBasis) +
    monthlyExpenseFromPeriods(payload.expensePeriods ?? [], monthISO)
  );
}
