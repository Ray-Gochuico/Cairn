import { create } from 'zustand';
import { SettingsRepo } from '@/domain/app-settings';
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

// In-flight de-dupe: load() is called from multiple mounts (Sidebar,
// CalculatorsLayout) and has no natural single-owner. Without this, three
// concurrent loads issue three SELECTs and could each fire the post-load
// import. We share one promise; callers all await the same read. Cleared in a
// finally so the next load() after settle re-reads (settings can change).
let loadInflight: Promise<void> | null = null;

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  isLoading: false,
  error: null,

  load: async () => {
    if (loadInflight) return loadInflight;
    loadInflight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const repo = new SettingsRepo(getDatabase());
        const settings = await repo.get();
        set({ settings, isLoading: false });
        // Fire-and-forget one-time legacy import. Single-fire-latched inside;
        // a no-op once the DB field is non-null. Must NOT block or reject the
        // load (fail-soft), so we don't await and swallow defensively.
        setTimeout(() => void importCalcVisibilityIfNeeded().catch(() => {}), 0);
      } catch (e) {
        set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      }
    })();
    try {
      return await loadInflight;
    } finally {
      loadInflight = null;
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
