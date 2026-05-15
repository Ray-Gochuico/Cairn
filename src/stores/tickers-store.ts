import { create } from 'zustand';
import { TickersRepo } from '@/domain/tickers';
import { getDatabase } from '@/db/db';
import type { Ticker } from '@/types/schema';

interface TickersState {
  tickers: Ticker[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  upsert: (ticker: Ticker) => Promise<void>;
  remove: (ticker: string) => Promise<void>;
  lookup: (ticker: string) => Ticker | undefined;
}

export const useTickersStore = create<TickersState>((set, get) => ({
  tickers: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new TickersRepo(getDatabase());
      const tickers = await repo.list();
      set({ tickers, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  upsert: async (ticker) => {
    const repo = new TickersRepo(getDatabase());
    await repo.upsert(ticker);
    await get().load();
  },

  remove: async (ticker) => {
    const repo = new TickersRepo(getDatabase());
    await repo.delete(ticker);
    await get().load();
  },

  lookup: (ticker) => {
    return get().tickers.find((t) => t.ticker === ticker);
  },
}));
