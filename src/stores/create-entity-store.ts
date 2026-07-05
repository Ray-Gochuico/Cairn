/**
 * Shared load() factory for entity stores: the `{ <dataKey>, isLoading,
 * error }` slice plus in-flight de-dupe, extracted from the hand-rolled
 * guards that grew store-by-store (loans → persons → snapshots → the five
 * migrated in Wave 5).
 *
 * Semantics (repo conventions.md, state layer):
 *   - load() SWALLOWS errors into state.error and never rethrows.
 *   - Concurrent load() calls collapse to one repo query; the in-flight
 *     promise is returned to every caller and cleared after settle (in
 *     `finally`, so an error path can't wedge the guard shut).
 *
 * Known, accepted TOCTOU (do NOT "fix" without re-reading this — canonical
 * note, relocated from persons-store when the hand-rolled guards migrated
 * here in wave 6): a CRUD mutation's `await get().load()` that fires while
 * ANY load() is still in flight — not just the initial-mount one — collapses
 * into that pre-write in-flight promise and can briefly show stale data
 * until the next load. The common window in practice is the sub-second,
 * pre-interactive initial-mount race on the async Tauri adapter; another is
 * PARALLEL mutations against one store, where the second write's trailing
 * refresh piggybacks the first's — so don't batch parallel mutations
 * against a single store and rely on each one's own load() for freshness
 * (sequence them, or issue one load after the batch settles).
 * Unreproducible on the synchronous better-sqlite3 test adapter (the
 * piggybacked SELECT runs after the write commits), so it has no honest
 * regression test. Accepted as negligible by the Track-3 final review
 * (2026-06-01). A bypass (clear the guard before the post-write load, or
 * add a private forceReload()) was scoped and declined: many stores of
 * churn in hot code for a defect with no testable failure.
 *
 * Deliberately NOT a whole-store factory: each store's data key (`accounts`,
 * `properties`, …) is public API with many component consumers, and CRUD
 * shapes diverge (optimistic vs reload-after-write). The load slice is the
 * duplicated part, so the load slice is what's shared.
 *
 * Wave 6 migrated every mechanically-migratable store onto this factory
 * (or createDedupedLoadPartial below). Deliberate NON-users — do not
 * migrate without redesigning the factory:
 *   - disclosure-acceptances-store: tri-state `status` + fail-closed load
 *     timeout (boot-gate safety; see the shared-store-gate-boot-loop
 *     gotcha). Its per-outcome status writes don't fit the factory.
 *   - tax-rules-store: parameterized loadYear(year) with a result-cache
 *     early return (a cache, not an in-flight guard) + two-field writes.
 *   - loan-payments-store: parameterized loadForLoan(loanId) — a single
 *     shared promise would wrongly collapse loads for DIFFERENT loans.
 */

export interface EntityLoadState {
  isLoading: boolean;
  error: string | null;
}

/**
 * Build a de-duplicated `load()` for a zustand store.
 *
 * @param set   the store's `set` (accepts a Partial of the state)
 * @param key   the state property the fetched value lands in
 * @param fetchData  the repo read; constructed per-call so it always sees
 *                   the current getDatabase() handle
 */
export function createDedupedLoad<TState extends EntityLoadState, K extends keyof TState>(
  set: (partial: Partial<TState>) => void,
  key: K,
  fetchData: () => Promise<TState[K]>,
): () => Promise<void> {
  let inflight: Promise<void> | null = null;
  return () => {
    if (inflight) return inflight;
    inflight = (async () => {
      // Casts: TS can't relate object literals with generic/computed keys to
      // Partial<TState>, but TState extends EntityLoadState and K is keyof
      // TState, so both literals are structurally safe.
      set({ isLoading: true, error: null } as Partial<TState>);
      try {
        const data = await fetchData();
        set({ [key]: data, isLoading: false } as unknown as Partial<TState>);
      } catch (e) {
        set({
          isLoading: false,
          error: e instanceof Error ? e.message : 'Failed to load',
        } as Partial<TState>);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}

/**
 * Multi-key sibling of createDedupedLoad for stores whose one load lands
 * SEVERAL state fields (learning-state: learningState + answeredQuestionIds
 * + answeredKeysByDay). Identical semantics — swallow-into-error, in-flight
 * collapse, guard cleared in finally — but `fetchPartial` returns a Partial
 * of the state that is spread on success. Prefer createDedupedLoad when a
 * single key suffices.
 */
export function createDedupedLoadPartial<TState extends EntityLoadState>(
  set: (partial: Partial<TState>) => void,
  // Omit the factory-managed keys so a fetcher can't accidentally clobber
  // the isLoading/error lifecycle it doesn't own (review minor).
  fetchPartial: () => Promise<Omit<Partial<TState>, 'isLoading' | 'error'>>,
): () => Promise<void> {
  let inflight: Promise<void> | null = null;
  return () => {
    if (inflight) return inflight;
    inflight = (async () => {
      set({ isLoading: true, error: null } as Partial<TState>);
      try {
        const partial = await fetchPartial();
        set({ ...partial, isLoading: false } as Partial<TState>);
      } catch (e) {
        set({
          isLoading: false,
          error: e instanceof Error ? e.message : 'Failed to load',
        } as Partial<TState>);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}
