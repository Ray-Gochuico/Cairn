import { create } from 'zustand';
import { VehiclesRepo } from '@/domain/vehicles';
import { getDatabase } from '@/db/db';
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

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new VehiclesRepo(getDatabase());
      const vehicles = await repo.list();
      set({ vehicles, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (vehicle) => {
    const repo = new VehiclesRepo(getDatabase());
    const id = await repo.create(vehicle);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new VehiclesRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new VehiclesRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
