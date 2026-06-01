import { create } from 'zustand';
import { LoansRepo } from '@/domain/loans';
import { getDatabase } from '@/db/db';
import type { Loan } from '@/types/schema';

/**
 * In-flight de-dupe: if a load() is already in progress, return its promise
 * instead of starting a second DB round-trip. Cleared after settle so later
 * load() calls (after a CRUD mutation) still re-fetch.
 */
let loansInflight: Promise<void> | null = null;

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

  load: async () => {
    if (loansInflight) return loansInflight;
    loansInflight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const repo = new LoansRepo(getDatabase());
        const loans = await repo.list();
        set({ loans, isLoading: false });
      } catch (e) {
        set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      } finally {
        loansInflight = null;
      }
    })();
    return loansInflight;
  },

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
