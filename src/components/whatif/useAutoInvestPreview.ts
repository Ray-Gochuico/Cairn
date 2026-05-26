import { useMemo } from 'react';
import { currentMonthlySalarySurplus } from '@/lib/scenarios';
import type { LeverPayload } from '@/lib/scenarios';
import { useRealState } from './useRealState';

/**
 * Compute the "auto-invest right now" preview amount, in nominal $/month.
 *
 * Wraps `currentMonthlySalarySurplus` for use inside React components — pulls
 * `RealState` from the existing stores via `useRealState()` and runs the
 * engine for two months with contributions stripped. Returns 0 whenever
 * `real` is unavailable (e.g. household not yet seeded) or the lever payload
 * is null. The wrapping component just renders the number.
 *
 * Memoized on the lever payload identity so toggling other pills doesn't
 * re-project the engine on every render.
 */
export function useAutoInvestPreview(leverPayload: LeverPayload | null | undefined): number {
  const real = useRealState();
  return useMemo(() => {
    if (!real || !leverPayload) return 0;
    return currentMonthlySalarySurplus(real, leverPayload);
  }, [real, leverPayload]);
}
