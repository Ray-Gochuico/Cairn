import { create } from 'zustand';
import { VehicleLeasesRepo } from '@/domain/vehicle-leases';
import { getDatabase } from '@/db/db';
import type { VehicleLease } from '@/types/schema';

interface VehicleLeasesState {
  vehicleLeases: VehicleLease[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (lease: Omit<VehicleLease, 'id'>) => Promise<number>;
  update: (
    id: number,
    patch: Partial<Omit<VehicleLease, 'id' | 'householdId'>>,
  ) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useVehicleLeasesStore = create<VehicleLeasesState>((set, get) => ({
  vehicleLeases: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new VehicleLeasesRepo(getDatabase());
      const vehicleLeases = await repo.list();
      set({ vehicleLeases, isLoading: false });
    } catch (e) {
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : 'Failed to load',
      });
    }
  },

  create: async (lease) => {
    const repo = new VehicleLeasesRepo(getDatabase());
    const id = await repo.create(lease);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new VehicleLeasesRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new VehicleLeasesRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
