import { create } from 'zustand';
import { FundSectorsRepo } from '@/domain/fund-sectors';
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

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new FundSectorsRepo(getDatabase());
      const fundSectors = await repo.listAll();
      set({ fundSectors, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },
}));
