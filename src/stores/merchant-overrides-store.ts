import { create } from 'zustand';
import { MerchantOverridesRepo } from '@/domain/merchant-overrides';
import { getDatabase } from '@/db/db';
import type { MerchantOverride } from '@/types/schema';

interface MerchantOverridesState {
  overrides: MerchantOverride[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (override: Omit<MerchantOverride, 'id' | 'createdFromCorrectionAt'>) => Promise<number>;
  remove: (id: number) => Promise<void>;
  upsertForMerchant: (householdId: number, pattern: string, categoryId: number) => Promise<void>;
}

export const useMerchantOverridesStore = create<MerchantOverridesState>((set, get) => ({
  overrides: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new MerchantOverridesRepo(getDatabase());
      const overrides = await repo.list();
      set({ overrides, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (override) => {
    const repo = new MerchantOverridesRepo(getDatabase());
    const id = await repo.create(override);
    await get().load();
    return id;
  },

  remove: async (id) => {
    const repo = new MerchantOverridesRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },

  upsertForMerchant: async (householdId, pattern, categoryId) => {
    const repo = new MerchantOverridesRepo(getDatabase());
    await repo.upsertForMerchant(householdId, pattern, categoryId);
    await get().load();
  },
}));
