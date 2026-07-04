import { create } from 'zustand';
import { VehiclesRepo } from '@/domain/vehicles';
import { getDatabase } from '@/db/db';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import type { Vehicle } from '@/types/schema';

/**
 * In-flight de-dupe: if a load() is already in progress, return its promise
 * instead of starting a second DB round-trip. Cleared after settle so later
 * load() calls (after a CRUD mutation) still re-fetch. Carries the accepted
 * initial-mount TOCTOU documented in src/stores/persons-store.ts.
 */
let vehiclesInflight: Promise<void> | null = null;

interface VehiclesState {
  vehicles: Vehicle[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (vehicle: Omit<Vehicle, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Vehicle, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useVehiclesStore = create<VehiclesState>((set, get) => ({
  vehicles: [],
  isLoading: false,
  error: null,

  load: async () => {
    if (vehiclesInflight) return vehiclesInflight;
    vehiclesInflight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const repo = new VehiclesRepo(getDatabase());
        const vehicles = await repo.list();
        set({ vehicles, isLoading: false });
      } catch (e) {
        set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      } finally {
        vehiclesInflight = null;
      }
    })();
    return vehiclesInflight;
  },

  create: async (vehicle) => {
    const repo = new VehiclesRepo(getDatabase());
    const id = await repo.create(vehicle);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new VehiclesRepo(getDatabase());
    const before = get().vehicles.find((v) => v.id === id);
    await repo.update(id, patch);
    // Wave 2 §4: an estimate edit IS a value observation. Once an entity has
    // asset_value_snapshots, every Net Worth surface prices it at the latest
    // snapshot and the estimate field is dead weight — so record the edit as
    // today's snapshot (same-date convention enforced by upsertForDate).
    // Gated to actual CHANGES: the tabs submit the full form, so an
    // unconditional write would snapshot every unrelated edit. Cross-store
    // getState() per the household-store precedent; failures rethrow.
    if (
      patch.currentEstimatedValue !== undefined &&
      patch.currentEstimatedValue !== null &&
      before !== undefined &&
      patch.currentEstimatedValue !== before.currentEstimatedValue
    ) {
      const todayIso = new Date().toISOString().slice(0, 10);
      await useAssetValueSnapshotsStore
        .getState()
        .upsertForDate('VEHICLE', id, todayIso, patch.currentEstimatedValue);
    }
    await get().load();
  },

  remove: async (id) => {
    const repo = new VehiclesRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
