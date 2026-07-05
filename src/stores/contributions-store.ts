import { create } from 'zustand';
import { ContributionsRepo } from '@/domain/contributions';
import { createDedupedLoad } from '@/stores/create-entity-store';
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

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<ContributionsState, 'contributions'>(set, 'contributions', async () =>
    new ContributionsRepo(getDatabase()).listAll(),
  ),

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
