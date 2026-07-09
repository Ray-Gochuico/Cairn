/**
 * Round-3 helper consolidation: ONE mechanism behind the dashboard/whatif
 * gate-seed helpers (tests/components/dashboard-gate-seed.ts and
 * tests/pages/whatif-store-seed.ts are thin wrappers over this).
 *
 * Seeds each listed zustand store "resolved-empty": the given collection
 * fields, `isLoading: false`, `error: null`, and a NO-OP `load` so a page's
 * mount load can't flip the store back to loading and strand a useLoadGate
 * on the skeleton in a DB-less test.
 *
 * Contract (matches the pre-consolidation helpers byte-for-byte): seeding
 * REPLACES the listed fields via setState and restores nothing implicitly —
 * callers own restoration (the house resetStores() pattern).
 */

interface SeedableStore {
  setState: (partial: never) => void;
}

export interface ResolvedStoreSeed {
  store: SeedableStore;
  /** The store's collection field(s) to seed, e.g. `{ holdings: [] }`. */
  collections: Record<string, unknown>;
}

export function seedResolvedStores(seeds: ResolvedStoreSeed[]): void {
  for (const { store, collections } of seeds) {
    store.setState({
      ...collections,
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);
  }
}
