import { create } from 'zustand';
import { GoalsRepo } from '@/domain/goals';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import type { Goal } from '@/types/schema';

interface GoalsState {
  // Plan literal said `items`, but every sibling store uses an entity-specific
  // field name (loans, accounts, persons, etc). Using `goals` here for
  // consistency across the store layer.
  goals: Goal[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (goal: Omit<Goal, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Goal, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useGoalsStore = create<GoalsState>((set, get) => ({
  goals: [],
  isLoading: false,
  error: null,

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<GoalsState, 'goals'>(set, 'goals', async () =>
    new GoalsRepo(getDatabase()).list(),
  ),

  create: async (goal) => {
    const repo = new GoalsRepo(getDatabase());
    const id = await repo.create(goal);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new GoalsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new GoalsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
