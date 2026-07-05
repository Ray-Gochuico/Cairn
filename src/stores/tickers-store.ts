import { create } from 'zustand';
import { TickersRepo } from '@/domain/tickers';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import type { Ticker } from '@/types/schema';

interface TickersState {
  tickers: Ticker[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  upsert: (ticker: Ticker) => Promise<void>;
  remove: (ticker: string) => Promise<void>;
  setAccentColor: (ticker: string, color: string | null) => Promise<void>;
  lookup: (ticker: string) => Ticker | undefined;
}

export const useTickersStore = create<TickersState>((set, get) => ({
  tickers: [],
  isLoading: false,
  error: null,

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<TickersState, 'tickers'>(set, 'tickers', async () =>
    new TickersRepo(getDatabase()).list(),
  ),

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

  setAccentColor: async (ticker, color) => {
    const repo = new TickersRepo(getDatabase());
    await repo.setAccentColor(ticker, color);
    await get().load();
  },

  lookup: (ticker) => {
    return get().tickers.find((t) => t.ticker === ticker);
  },
}));
