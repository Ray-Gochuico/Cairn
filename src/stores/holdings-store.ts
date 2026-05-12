import { create } from 'zustand';
import { HoldingsRepo } from '@/domain/holdings';
import { getDatabase } from '@/db/db';
import type { Holding } from '@/types/schema';

interface HoldingsState {
  holdings: Holding[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (holding: Omit<Holding, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Holding, 'id' | 'accountId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useHoldingsStore = create<HoldingsState>((set, get) => ({
  holdings: [],
  isLoading: false,
  error: null,

  /**
   * Loads ALL holdings across every account. Per-account scoping is done
   * in-memory by callers (HoldingsTab, Investments page) — that lets the
   * UI swap accounts without re-querying. Components that genuinely need
   * a SQL-level filter can call HoldingsRepo.listForAccount directly.
   */
  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new HoldingsRepo(getDatabase());
      const holdings = await repo.listAll();
      set({ holdings, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (holding) => {
    const repo = new HoldingsRepo(getDatabase());
    const id = await repo.create(holding);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new HoldingsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new HoldingsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
