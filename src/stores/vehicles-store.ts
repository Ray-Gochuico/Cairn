import { create } from 'zustand';
import { VehiclesRepo } from '@/domain/vehicles';
import { getDatabase } from '@/db/db';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import type { Vehicle } from '@/types/schema';

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

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<VehiclesState, 'vehicles'>(set, 'vehicles', async () =>
    new VehiclesRepo(getDatabase()).list(),
  ),

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
