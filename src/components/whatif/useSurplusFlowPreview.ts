import { useMemo } from 'react';
import { currentSurplusFlow } from '@/lib/scenarios';
import type { LeverPayload } from '@/lib/scenarios';
import { useRealState } from './useRealState';

/**
 * Per-bucket monthly surplus preview. Sourced from the engine via
 * currentSurplusFlow: project two months with contribution segments stripped,
 * read the month-1 `gapTo*` fields, and surface them grouped.
 *
 * Returns zeros when the real state hasn't loaded yet or the lever payload
 * is null/undefined.
 *
 * The destination is implicit in the per-bucket breakdown: consumers that
 * need to render "going to investments" vs "going to cash" inspect the
 * non-zero buckets directly. There's no longer a household-level
 * `autoInvestSalarySurplus` setting to read.
 */
export interface SurplusFlow {
  /** Total monthly surplus = taxAdvantaged + brokerage + cash. */
  amount: number;
  taxAdvantaged: number;
  brokerage: number;
  cash: number;
}

const EMPTY_FLOW: SurplusFlow = {
  amount: 0,
  taxAdvantaged: 0,
  brokerage: 0,
  cash: 0,
};

export function useSurplusFlowPreview(
  leverPayload: LeverPayload | null | undefined,
): SurplusFlow {
  const real = useRealState();
  return useMemo<SurplusFlow>(() => {
    if (!real || !leverPayload) return EMPTY_FLOW;
    return currentSurplusFlow(real, leverPayload);
  }, [real, leverPayload]);
}
