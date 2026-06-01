import { create } from 'zustand';
import { ContributionsRepo } from '@/domain/contributions';
import { getDatabase } from '@/db/db';
import type { Contribution } from '@/types/schema';

/**
 * In-flight de-dupe: if a load() is already in progress, return its promise
 * instead of starting a second DB round-trip. Cleared after settle so later
 * load() calls (after a CRUD mutation) still re-fetch.
 */
let contributionsInflight: Promise<void> | null = null;

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
    if (contributionsInflight) return contributionsInflight;
    contributionsInflight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const repo = new ContributionsRepo(getDatabase());
        const contributions = await repo.listAll();
        set({ contributions, isLoading: false });
      } catch (e) {
        set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      } finally {
        contributionsInflight = null;
      }
    })();
    return contributionsInflight;
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
