import { create } from 'zustand';
import { EquityGrantsRepo } from '@/domain/equity-grants';
import { getDatabase } from '@/db/db';
import type { EquityGrant } from '@/types/schema';

interface EquityGrantsState {
  equityGrants: EquityGrant[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (grant: Omit<EquityGrant, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<EquityGrant, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useEquityGrantsStore = create<EquityGrantsState>((set, get) => ({
  equityGrants: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new EquityGrantsRepo(getDatabase());
      const equityGrants = await repo.list();
      set({ equityGrants, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (grant) => {
    const repo = new EquityGrantsRepo(getDatabase());
    const id = await repo.create(grant);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new EquityGrantsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new EquityGrantsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
