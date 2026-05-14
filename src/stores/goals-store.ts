import { create } from 'zustand';
import { GoalsRepo } from '@/domain/goals';
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

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new GoalsRepo(getDatabase());
      const goals = await repo.list();
      set({ goals, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

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
