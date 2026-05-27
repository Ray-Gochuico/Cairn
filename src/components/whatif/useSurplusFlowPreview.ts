import { useMemo } from 'react';
import { currentMonthlySalarySurplus } from '@/lib/scenarios';
import type { LeverPayload } from '@/lib/scenarios';
import { useRealState } from './useRealState';
import { useSettingsStore } from '@/stores/settings-store';

export interface SurplusFlow {
  /**
   * Monthly surplus amount in nominal $ — magnitude of (income − expenses −
   * loan payments) at the first stepped month, after stripping any
   * Contributions segments. 0 when the surplus is non-positive, the lever
   * payload is null, or the real state hasn't loaded yet.
   */
  amount: number;
  /**
   * Where the engine routes the surplus today, given the household's current
   * `auto_invest_salary_surplus` setting (migration 0029). The hook is the
   * single source of truth for this branching so the Contributions popover,
   * the LeverBar pill, and any future surface render consistent copy.
   *
   * - `'cash'` (the new default since 2026-05-26): surplus stays in cash;
   *   the UX nudges the user to add a Contributions segment to invest some.
   * - `'investments'`: the legacy auto-invest path is active; UX surfaces
   *   the "Auto-investing $X/mo" copy.
   */
  destination: 'cash' | 'investments';
}

/**
 * Compute the "where does my surplus go right now" preview.
 *
 * Used by the Contributions popover preview card, the LeverBar Contributions
 * pill, and (in principle) any other UI surface that needs to explain the
 * auto-invest behavior. The amount is computed exactly the same as before
 * the rename — only the return shape changed.
 *
 * Memoized on the (real, leverPayload, destination) triple so toggling
 * unrelated levers doesn't re-project the engine on every render.
 *
 * @see currentMonthlySalarySurplus for the engine-side computation.
 * @see migration 0029 + AppSettingsSchema.autoInvestSalarySurplus.
 */
export function useSurplusFlowPreview(
  leverPayload: LeverPayload | null | undefined,
): SurplusFlow {
  const real = useRealState();
  const destination: SurplusFlow['destination'] = useSettingsStore(
    (s) => s.settings?.autoInvestSalarySurplus,
  )
    ? 'investments'
    : 'cash';
  return useMemo<SurplusFlow>(() => {
    if (!real || !leverPayload) return { amount: 0, destination };
    return { amount: currentMonthlySalarySurplus(real, leverPayload), destination };
  }, [real, leverPayload, destination]);
}
