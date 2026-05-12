import { create } from 'zustand';
import { ContributionsRepo } from '@/domain/contributions';
import { getDatabase } from '@/db/db';
import type { Contribution } from '@/types/schema';

interface ContributionsState {
  contributions: Contribution[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (contribution: Omit<Contribution, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Contribution, 'id' | 'accountId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useContributionsStore = create<ContributionsState>((set, get) => ({
  contributions: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new ContributionsRepo(getDatabase());
      const contributions = await repo.listAll();
      set({ contributions, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (contribution) => {
    const repo = new ContributionsRepo(getDatabase());
    const id = await repo.create(contribution);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new ContributionsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new ContributionsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
