import { create } from 'zustand';
import { LoanPaymentsRepo } from '@/domain/loan-payments';
import { getDatabase } from '@/db/db';
import type { LoanPayment } from '@/types/schema';

interface LoanPaymentsState {
  /**
   * Wave C (DC10): keyed PER LOAN — several expanded loan cards on /loans
   * read their histories concurrently, so a single flat array would let the
   * last-loaded loan clobber every other card's rows. Pages that need a
   * loan's payment history call `loadForLoan(id)`; the monthly mini-window
   * writes through `create()` without reading any prior state, so we don't
   * preload here.
   */
  paymentsByLoanId: Record<number, LoanPayment[]>;
  isLoading: boolean;
  error: string | null;
  loadForLoan: (loanId: number) => Promise<void>;
  create: (payment: Omit<LoanPayment, 'id'>) => Promise<number>;
  update: (
    id: number,
    patch: Partial<Omit<LoanPayment, 'id' | 'loanId'>>,
  ) => Promise<void>;
  remove: (id: number, loanId: number) => Promise<void>;
}

export const useLoanPaymentsStore = create<LoanPaymentsState>((set) => ({
  paymentsByLoanId: {},
  isLoading: false,
  error: null,

  loadForLoan: async (loanId) => {
    set({ isLoading: true, error: null });
    try {
      const repo = new LoanPaymentsRepo(getDatabase());
      const payments = await repo.listForLoan(loanId);
      set((state) => ({
        paymentsByLoanId: { ...state.paymentsByLoanId, [loanId]: payments },
        isLoading: false,
      }));
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

  remove: async (id, loanId) => {
    const repo = new LoanPaymentsRepo(getDatabase());
    await repo.delete(id);
    set((state) => ({
      paymentsByLoanId: {
        ...state.paymentsByLoanId,
        [loanId]: (state.paymentsByLoanId[loanId] ?? []).filter((p) => p.id !== id),
      },
    }));
  },
}));
