import { create } from 'zustand';
import { LoansRepo } from '@/domain/loans';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import type { Loan } from '@/types/schema';

interface LoansState {
  loans: Loan[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (loan: Omit<Loan, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Loan, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

/**
 * LoansRepo.projectedSchedule is not exposed here — pages that need the
 * amortization schedule instantiate LoansRepo directly. Keeping the store
 * surface lean prevents per-loan schedule recomputation from sitting in
 * cached state and going stale silently.
 */
export const useLoansStore = create<LoansState>((set, get) => ({
  loans: [],
  isLoading: false,
  error: null,

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<LoansState, 'loans'>(set, 'loans', async () =>
    new LoansRepo(getDatabase()).list(),
  ),

  create: async (loan) => {
    const repo = new LoansRepo(getDatabase());
    const id = await repo.create(loan);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new LoansRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new LoansRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
