import { useCallback, useEffect, useRef, useState } from 'react';

export interface LoadGate {
  /**
   * True once this surface's loads have been kicked off AND every consumed
   * store has finished loading (success OR failure — a failed load settles
   * with `error` set so the page can show StoreErrorBanner instead of a
   * skeleton forever). LATCHED: once true, stays true for the component's
   * lifetime, so a descendant re-triggering a shared store's transient
   * isLoading (the shared-store-gate boot-loop gotcha) or a retry-in-flight
   * can never re-hide already-rendered content.
   */
  settled: boolean;
  /** The consumed stores' error fields, positionally — feed StoreErrorBanner. */
  errors: ReadonlyArray<string | null | undefined>;
  /** Re-run the surface's loads (StoreErrorBanner onRetry). */
  retry: () => void;
}

/**
 * The Wave-10 answer to the F6 false-empty class: pages/tabs used to gate
 * their empty states on `data.length === 0` while stores init `[]` and
 * hydrate in an effect — so first paint always showed "No X yet", and a
 * failed load told an existing user to start over. This hook owns the mount
 * load and defines "settled" once, so every surface renders exactly three
 * honest states: loading (not settled → skeleton), failed (settled + error →
 * StoreErrorBanner), and real data/empty (settled, no error).
 *
 * Usage (the house pattern — see NetWorth for the canonical adoption):
 *   const gate = useLoadGate(
 *     [useAStore((s) => s.isLoading), useBStore((s) => s.isLoading)],
 *     [useAStore((s) => s.error),     useBStore((s) => s.error)],
 *     reload, // the page's existing all-stores load callback
 *   );
 *   if (!gate.settled) return <PageLoadingSpinner />;
 *   // then: StoreErrorBanner errors={gate.errors} onRetry={gate.retry},
 *   // and the pre-existing length===0 EmptyState branch — now honest.
 *
 * The mount effect runs the load exactly once; `load` is read through a ref
 * so callers may pass an inline or memoized callback without re-arming it.
 * "Started" must come from the effect (not initial state): stores init
 * isLoading:false, so without it a cold mount would count as settled before
 * load() fired — the exact false-empty flash this hook exists to kill.
 */
export function useLoadGate(
  isLoading: ReadonlyArray<boolean>,
  errors: ReadonlyArray<string | null | undefined>,
  load: () => void,
): LoadGate {
  const [started, setStarted] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
    setStarted(true);
    // Mount-only by design; the ref keeps the latest load reachable.
  }, []);

  const settledRef = useRef(false);
  if (started && !isLoading.some(Boolean)) settledRef.current = true;

  const retry = useCallback(() => loadRef.current(), []);

  return { settled: settledRef.current, errors, retry };
}
