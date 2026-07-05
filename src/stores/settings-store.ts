import { create } from 'zustand';
import { SettingsRepo } from '@/domain/app-settings';
import { createDedupedLoad } from '@/stores/create-entity-store';
import { getDatabase } from '@/db/db';
import { importCalcVisibilityIfNeeded } from '@/lib/calculator-card-layout';
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

  // Shared de-duped load (see create-entity-store.ts). The one-time legacy
  // localStorage→DB calc-visibility import stays fire-and-forget on the
  // success path (macrotask-deferred; can never block or reject the load —
  // identical semantics to the pre-factory shape).
  load: createDedupedLoad<SettingsState, 'settings'>(set, 'settings', async () => {
    const settings = await new SettingsRepo(getDatabase()).get();
    setTimeout(() => void importCalcVisibilityIfNeeded().catch(() => {}), 0);
    return settings;
  }),

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
