import { create } from 'zustand';
import { HoldingsRepo } from '@/domain/holdings';
import { getDatabase } from '@/db/db';
import { createDedupedLoad } from '@/stores/create-entity-store';
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
   * in-memory by callers (the Investments page + its Manage surface) — that lets the
   * UI swap accounts without re-querying. Components that genuinely need
   * a SQL-level filter can call HoldingsRepo.listForAccount directly.
   *
   * Shared de-duped load (see create-entity-store.ts for semantics + the
   * accepted initial-mount TOCTOU).
   */
  load: createDedupedLoad<HoldingsState, 'holdings'>(set, 'holdings', async () =>
    new HoldingsRepo(getDatabase()).listAll(),
  ),

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
