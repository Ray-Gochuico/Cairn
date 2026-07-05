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
 * Known, accepted TOCTOU (do NOT "fix" without re-reading the long note in
 * src/stores/persons-store.ts): a CRUD mutation's `await get().load()` that
 * fires while an *initial* load() is still in flight piggybacks the
 * pre-mutation promise and could briefly show stale data. Unreproducible on
 * the synchronous better-sqlite3 test adapter; accepted as negligible by the
 * Track-3 final review (2026-06-01).
 *
 * Deliberately NOT a whole-store factory: each store's data key (`accounts`,
 * `properties`, …) is public API with many component consumers, and CRUD
 * shapes diverge (optimistic vs reload-after-write). The load slice is the
 * duplicated part, so the load slice is what's shared. Migrating the ~15
 * remaining stores onto this is a known follow-up.
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
  fetchPartial: () => Promise<Partial<TState>>,
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
