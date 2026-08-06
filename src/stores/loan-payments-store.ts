import { create } from 'zustand';
import { LoanPaymentsRepo } from '@/domain/loan-payments';
import { LoansRepo } from '@/domain/loans';
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
    const db = getDatabase();
    const repo = new LoanPaymentsRepo(db);
    // Wave C review (MAJOR 1): Monthly's Confirm writes a COUPLED pair —
    // payment INSERT + loans.currentBalance decrement (MonthlyMiniWindow's
    // LoanPaymentCard, insert-then-decrement). Deleting only the row left
    // the decrement orphaned, so the CW26 delete → re-confirm loop
    // double-decremented the balance (the 0049 corruption class). Read the
    // row first, delete it, then restore the coupled decrement for
    // AMORTIZATION rows — the exact inverse pair, same (non-transactional)
    // failure envelope as the create path it mirrors.
    const row = await repo.findById(id);
    await repo.delete(id);
    if (row?.source === 'AMORTIZATION') {
      const loansRepo = new LoansRepo(db);
      const loan = await loansRepo.findById(loanId);
      if (loan) {
        await loansRepo.update(loanId, {
          currentBalance: loan.currentBalance + row.principal + row.extra,
        });
      }
    }
    set((state) => {
      // Never-cached loanId → nothing to prune; creating a phantom [] here
      // would flip the UI's "loaded" signal (paymentsByLoanId[loanId]
      // definedness) without a load ever running.
      const cached = state.paymentsByLoanId[loanId];
      if (!cached) return state;
      return {
        paymentsByLoanId: {
          ...state.paymentsByLoanId,
          [loanId]: cached.filter((p) => p.id !== id),
        },
      };
    });
  },
}));
