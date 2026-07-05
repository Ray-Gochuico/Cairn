import { create } from 'zustand';
import { EquityGrantsRepo } from '@/domain/equity-grants';
import { createDedupedLoad } from '@/stores/create-entity-store';
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

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<EquityGrantsState, 'equityGrants'>(set, 'equityGrants', async () =>
    new EquityGrantsRepo(getDatabase()).list(),
  ),

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
