import { create } from 'zustand';
import { FundHoldingsRepo } from '@/domain/fund-holdings';
import { createDedupedLoad } from '@/stores/create-entity-store';
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

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<FundHoldingsState, 'fundHoldings'>(set, 'fundHoldings', async () =>
    new FundHoldingsRepo(getDatabase()).listAll(),
  ),

  getForFund: (fundTicker) => {
    return get().fundHoldings.filter((h) => h.fundTicker === fundTicker);
  },
}));
