import { create } from 'zustand';
import { FundHoldingsRepo } from '@/domain/fund-holdings';
import { getDatabase } from '@/db/db';
import type { FundHolding } from '@/types/schema';

interface FundHoldingsState {
  fundHoldings: FundHolding[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  getForFund: (fundTicker: string) => FundHolding[];
}

export const useFundHoldingsStore = create<FundHoldingsState>((set, get) => ({
  fundHoldings: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new FundHoldingsRepo(getDatabase());
      const fundHoldings = await repo.listAll();
      set({ fundHoldings, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  getForFund: (fundTicker) => {
    return get().fundHoldings.filter((h) => h.fundTicker === fundTicker);
  },
}));
