import { create } from 'zustand';
import { SettingsRepo } from '@/domain/app-settings';
import { getDatabase } from '@/db/db';
import type { AppSettings } from '@/types/schema';

interface SettingsState {
  settings: AppSettings | null;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: (patch: Partial<Omit<AppSettings, 'id'>>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new SettingsRepo(getDatabase());
      const settings = await repo.get();
      set({ settings, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  update: async (patch) => {
    set({ isLoading: true, error: null });
    try {
      const repo = new SettingsRepo(getDatabase());
      await repo.update(patch);
      const settings = await repo.get();
      set({ settings, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to update' });
      throw e;
    }
  },
}));
