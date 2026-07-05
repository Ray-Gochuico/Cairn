import { create } from 'zustand';
import { FundSectorsRepo } from '@/domain/fund-sectors';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import type { FundSector } from '@/types/schema';

interface FundSectorsState {
  fundSectors: FundSector[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useFundSectorsStore = create<FundSectorsState>((set) => ({
  fundSectors: [],
  isLoading: false,
  error: null,

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU).
  load: createDedupedLoad<FundSectorsState, 'fundSectors'>(set, 'fundSectors', async () =>
    new FundSectorsRepo(getDatabase()).listAll(),
  ),
}));
