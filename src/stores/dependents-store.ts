import { create } from 'zustand';
import { DependentsRepo } from '@/domain/dependents';
import { getDatabase } from '@/db/db';
import type { Dependent } from '@/types/schema';

/**
 * In-flight de-dupe: if a load() is already in progress, return its promise
 * instead of starting a second DB round-trip. Cleared after settle so later
 * load() calls (after a CRUD mutation) still re-fetch.
 */
let dependentsInflight: Promise<void> | null = null;

interface DependentsState {
  dependents: Dependent[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (dependent: Omit<Dependent, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Dependent, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useDependentsStore = create<DependentsState>((set, get) => ({
  dependents: [],
  isLoading: false,
  error: null,

  load: async () => {
    if (dependentsInflight) return dependentsInflight;
    dependentsInflight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const repo = new DependentsRepo(getDatabase());
        const dependents = await repo.list();
        set({ dependents, isLoading: false });
      } catch (e) {
        set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      } finally {
        dependentsInflight = null;
      }
    })();
    return dependentsInflight;
  },

  create: async (dependent) => {
    const repo = new DependentsRepo(getDatabase());
    const id = await repo.create(dependent);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new DependentsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new DependentsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
