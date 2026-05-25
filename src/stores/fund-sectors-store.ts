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
    // eslint-disable-next-line no-console
    console.log('[useFundSectorsStore.load] start');
    set({ isLoading: true, error: null });
    try {
      const repo = new FundSectorsRepo(getDatabase());
      const fundSectors = await repo.listAll();
      // eslint-disable-next-line no-console
      console.log('[useFundSectorsStore.load] ok', {
        rowCount: fundSectors.length,
        uniqueFundTickers: [...new Set(fundSectors.map((fs) => fs.fundTicker))],
      });
      set({ fundSectors, isLoading: false });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[useFundSectorsStore.load] FAILED', {
        error: e instanceof Error ? { message: e.message, stack: e.stack } : e,
      });
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },
}));
