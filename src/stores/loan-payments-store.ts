import { create } from 'zustand';
import { LoanPaymentsRepo } from '@/domain/loan-payments';
import { getDatabase } from '@/db/db';
import type { LoanPayment } from '@/types/schema';

interface LoanPaymentsState {
  /**
   * Phase 2 keeps the cache empty by default — pages that need a loan's
   * payment history fetch via the repo or call `loadForLoan(id)`. The
   * monthly mini-window writes through `create()` without reading any
   * prior state, so we don't preload here.
   */
  payments: LoanPayment[];
  isLoading: boolean;
  error: string | null;
  loadForLoan: (loanId: number) => Promise<void>;
  create: (payment: Omit<LoanPayment, 'id'>) => Promise<number>;
  update: (
    id: number,
    patch: Partial<Omit<LoanPayment, 'id' | 'loanId'>>,
  ) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useLoanPaymentsStore = create<LoanPaymentsState>((set) => ({
  payments: [],
  isLoading: false,
  error: null,

  loadForLoan: async (loanId) => {
    set({ isLoading: true, error: null });
    try {
      const repo = new LoanPaymentsRepo(getDatabase());
      const payments = await repo.listForLoan(loanId);
      set({ payments, isLoading: false });
    } catch (e) {
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : 'Failed to load',
      });
    }
  },

  create: async (payment) => {
    const repo = new LoanPaymentsRepo(getDatabase());
    return repo.create(payment);
  },

  update: async (id, patch) => {
    const repo = new LoanPaymentsRepo(getDatabase());
    await repo.update(id, patch);
  },

  remove: async (id) => {
    const repo = new LoanPaymentsRepo(getDatabase());
    await repo.delete(id);
  },
}));
