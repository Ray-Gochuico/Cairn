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
  /**
   * Insert-or-update the row for (ownerType, ownerId, snapshotDate) and sync
   * the cache. NOT optimistic (unlike the other mutations): create-vs-update
   * needs the repo's authoritative SELECT because the table has no unique
   * constraint — an optimistic guess from a possibly-unloaded cache could
   * mint duplicate same-date rows. Rethrows on failure (store conventions).
   */
  upsertForDate: (
    ownerType: AssetSnapshotOwnerType,
    ownerId: number,
    snapshotDate: string,
    value: number,
  ) => Promise<number>;
}

let nextTempId = -1;
const allocTempId = () => nextTempId--;

/**
 * In-flight de-dupe: if a load() is already in progress, return its promise
 * instead of starting a second DB round-trip. Cleared after settle so later
 * load() calls still re-fetch. Carries the accepted initial-mount TOCTOU
 * documented in src/stores/persons-store.ts.
 */
let assetValueSnapshotsInflight: Promise<void> | null = null;

/**
 * Mirrors AssetValueSnapshotsRepo.list() ordering:
 * `ORDER BY snapshot_date DESC, id DESC`. The reducer applies this after
 * every optimistic mutation so the in-memory array matches what a reload
 * would produce.
 */
function sortAssetSnapshots(rows: AssetValueSnapshot[]): AssetValueSnapshot[] {
  return [...rows].sort((a, b) => {
    if (a.snapshotDate !== b.snapshotDate) {
      return a.snapshotDate < b.snapshotDate ? 1 : -1;
    }
    return (b.id ?? 0) - (a.id ?? 0);
  });
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
 *                                                and apply optimistically
 *                                                with rollback-on-error
 *
 * Optimistic writes: every mutation mutates the local array first, then
 * awaits the DB write. On failure, the pre-write snapshot is restored and
 * the error rethrows. This replaces the previous post-write `load()`
 * pattern, which paid a full-table SELECT and re-rendered every consuming
 * card on each single-row edit.
 */
export const useAssetValueSnapshotsStore = create<AssetValueSnapshotsState>(
  (set, get) => ({
    assetValueSnapshots: [],
    isLoading: false,
    error: null,

    load: async () => {
      if (assetValueSnapshotsInflight) return assetValueSnapshotsInflight;
      assetValueSnapshotsInflight = (async () => {
        set({ isLoading: true, error: null });
        try {
          const items = await new AssetValueSnapshotsRepo(getDatabase()).list();
          set({ assetValueSnapshots: items, isLoading: false });
        } catch (e) {
          set({
            isLoading: false,
            error: e instanceof Error ? e.message : 'Failed to load',
          });
        } finally {
          assetValueSnapshotsInflight = null;
        }
      })();
      return assetValueSnapshotsInflight;
    },

    create: async (snap) => {
      const repo = new AssetValueSnapshotsRepo(getDatabase());
      const tempId = allocTempId();
      const optimistic: AssetValueSnapshot = { ...snap, id: tempId };
      const prev = get().assetValueSnapshots;
      set({
        assetValueSnapshots: sortAssetSnapshots([...prev, optimistic]),
      });
      try {
        const realId = await repo.create(snap);
        set({
          assetValueSnapshots: sortAssetSnapshots(
            get().assetValueSnapshots.map((s) =>
              s.id === tempId ? { ...s, id: realId } : s,
            ),
          ),
        });
        return realId;
      } catch (e) {
        set({ assetValueSnapshots: prev });
        throw e;
      }
    },

    update: async (id, patch) => {
      const repo = new AssetValueSnapshotsRepo(getDatabase());
      const prev = get().assetValueSnapshots;
      const existing = prev.find((s) => s.id === id);
      if (!existing) {
        // Not in cache — defer to repo + full reload (consumer's view of
        // the world is stale, the reload re-syncs).
        await repo.update(id, patch);
        await get().load();
        return;
      }
      const optimistic: AssetValueSnapshot = { ...existing, ...patch };
      set({
        assetValueSnapshots: sortAssetSnapshots(
          prev.map((s) => (s.id === id ? optimistic : s)),
        ),
      });
      try {
        await repo.update(id, patch);
      } catch (e) {
        set({ assetValueSnapshots: prev });
        throw e;
      }
    },

    remove: async (id) => {
      const repo = new AssetValueSnapshotsRepo(getDatabase());
      const prev = get().assetValueSnapshots;
      const existed = prev.find((s) => s.id === id);
      if (!existed) {
        await repo.delete(id);
        return;
      }
      set({
        assetValueSnapshots: prev.filter((s) => s.id !== id),
      });
      try {
        await repo.delete(id);
      } catch (e) {
        set({ assetValueSnapshots: prev });
        throw e;
      }
    },

    removeForOwner: async (ownerType, ownerId) => {
      const repo = new AssetValueSnapshotsRepo(getDatabase());
      const prev = get().assetValueSnapshots;
      // Bulk filter: drop every snapshot tied to this (ownerType, ownerId)
      // pair. The repo does the same DELETE in SQL.
      set({
        assetValueSnapshots: prev.filter(
          (s) => !(s.ownerType === ownerType && s.ownerId === ownerId),
        ),
      });
      try {
        await repo.deleteForOwner(ownerType, ownerId);
      } catch (e) {
        set({ assetValueSnapshots: prev });
        throw e;
      }
    },

    upsertForDate: async (ownerType, ownerId, snapshotDate, value) => {
      const repo = new AssetValueSnapshotsRepo(getDatabase());
      const id = await repo.upsertForDate(ownerType, ownerId, snapshotDate, value);
      const next = [...get().assetValueSnapshots];
      const idx = next.findIndex((s) => s.id === id);
      const row: AssetValueSnapshot = { id, ownerType, ownerId, snapshotDate, value };
      if (idx >= 0) next[idx] = row;
      else next.push(row);
      set({ assetValueSnapshots: sortAssetSnapshots(next) });
      return id;
    },
  }),
);
