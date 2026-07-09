import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { seedResolvedStores } from './seed-resolved-stores';

interface ToyState {
  things: Array<{ id: number }>;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

function makeToyStore() {
  return create<ToyState>(() => ({
    things: [{ id: 1 }],
    isLoading: true,
    error: 'boom',
    load: async () => {
      throw new Error('real load should be replaced');
    },
  }));
}

describe('seedResolvedStores (round-3 helper consolidation)', () => {
  it('leaves each store resolved-empty with a no-op load', async () => {
    const a = makeToyStore();
    const b = makeToyStore();
    seedResolvedStores([
      { store: a, collections: { things: [] } },
      { store: b, collections: { things: [{ id: 9 }] } },
    ]);
    for (const s of [a, b]) {
      expect(s.getState().isLoading).toBe(false);
      expect(s.getState().error).toBeNull();
      await expect(s.getState().load()).resolves.toBeUndefined(); // no-op
    }
    expect(a.getState().things).toEqual([]);
    expect(b.getState().things).toEqual([{ id: 9 }]);
  });

  it('does not restore anything implicitly — callers own restoration', () => {
    // Documented contract (matches the two existing gate-seed helpers):
    // seeding REPLACES the listed fields via setState and never snapshots
    // prior state. A second seed simply overwrites again.
    const a = makeToyStore();
    seedResolvedStores([{ store: a, collections: { things: [] } }]);
    seedResolvedStores([{ store: a, collections: { things: [{ id: 2 }] } }]);
    expect(a.getState().things).toEqual([{ id: 2 }]);
  });
});
