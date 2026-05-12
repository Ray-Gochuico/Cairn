import { create } from 'zustand';
import { PropertiesRepo } from '@/domain/properties';
import { getDatabase } from '@/db/db';
import type { Property } from '@/types/schema';

interface PropertiesState {
  properties: Property[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (property: Omit<Property, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Property, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const usePropertiesStore = create<PropertiesState>((set, get) => ({
  properties: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new PropertiesRepo(getDatabase());
      const properties = await repo.list();
      set({ properties, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (property) => {
    const repo = new PropertiesRepo(getDatabase());
    const id = await repo.create(property);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new PropertiesRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new PropertiesRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
