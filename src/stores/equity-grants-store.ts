import { create } from 'zustand';
import { EquityGrantsRepo } from '@/domain/equity-grants';
import { getDatabase } from '@/db/db';
import type { EquityGrant } from '@/types/schema';

/**
 * In-flight de-dupe: if a load() is already in progress, return its promise
 * instead of starting a second DB round-trip. Cleared after settle so later
 * load() calls (after a CRUD mutation) still re-fetch.
 */
let equityGrantsInflight: Promise<void> | null = null;

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
    if (equityGrantsInflight) return equityGrantsInflight;
    equityGrantsInflight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const repo = new EquityGrantsRepo(getDatabase());
        const equityGrants = await repo.list();
        set({ equityGrants, isLoading: false });
      } catch (e) {
        set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      } finally {
        equityGrantsInflight = null;
      }
    })();
    return equityGrantsInflight;
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
