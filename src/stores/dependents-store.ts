import { create } from 'zustand';
import { DependentsRepo } from '@/domain/dependents';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import type { Dependent } from '@/types/schema';

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

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<DependentsState, 'dependents'>(set, 'dependents', async () =>
    new DependentsRepo(getDatabase()).list(),
  ),

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
