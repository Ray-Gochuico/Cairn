import { create } from 'zustand';
import { getDatabase } from '@/db/db';
import { AssetValueSnapshotsRepo } from '@/domain/asset-value-snapshots';
import type { AssetValueSnapshot } from '@/types/schema';
import type { AssetSnapshotOwnerType } from '@/types/enums';

interface AssetValueSnapshotsState {
  assetValueSnapshots: AssetValueSnapshot[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (snap: Omit<AssetValueSnapshot, 'id'>) => Promise<number>;
  update: (
    id: number,
    patch: Partial<Omit<AssetValueSnapshot, 'id'>>,
  ) => Promise<void>;
  remove: (id: number) => Promise<void>;
  removeForOwner: (
    ownerType: AssetSnapshotOwnerType,
    ownerId: number,
  ) => Promise<void>;
}

/**
 * One store shared by every Property card and Vehicle card. Components
 * filter by (ownerType, ownerId) in a useMemo at the consumption site —
 * keeping a single store avoids 1+N stale-cache problems on the Net
 * Worth page where every property and vehicle slice needs the same data.
 *
 * Error semantics follow the conventions.md state-layer rules:
 *   load()   — swallows errors into state.error
 *   create / update / remove / removeForOwner — rethrow on failure
 *                                                and re-load on success
 */
export const useAssetValueSnapshotsStore = create<AssetValueSnapshotsState>(
  (set, get) => ({
    assetValueSnapshots: [],
    isLoading: false,
    error: null,

    load: async () => {
      set({ isLoading: true, error: null });
      try {
        const items = await new AssetValueSnapshotsRepo(getDatabase()).list();
        set({ assetValueSnapshots: items, isLoading: false });
      } catch (e) {
        set({
          isLoading: false,
          error: e instanceof Error ? e.message : 'Failed to load',
        });
      }
    },

    create: async (snap) => {
      const id = await new AssetValueSnapshotsRepo(getDatabase()).create(snap);
      await get().load();
      return id;
    },

    update: async (id, patch) => {
      await new AssetValueSnapshotsRepo(getDatabase()).update(id, patch);
      await get().load();
    },

    remove: async (id) => {
      await new AssetValueSnapshotsRepo(getDatabase()).delete(id);
      await get().load();
    },

    removeForOwner: async (ownerType, ownerId) => {
      await new AssetValueSnapshotsRepo(getDatabase()).deleteForOwner(
        ownerType,
        ownerId,
      );
      await get().load();
    },
  }),
);
