import { create } from 'zustand';
import { HouseholdRepo, type DisclosureDocumentId } from '@/domain/household';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { getDatabase } from '@/db/db';
import type { Household } from '@/types/schema';

interface HouseholdState {
  household: Household | null;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: (patch: Partial<Omit<Household, 'id'>>) => Promise<void>;
  /**
   * Record the user's acceptance of a disclosure version. Appends the
   * audit row to disclosure_acceptances (the single source of truth,
   * MF-1) and refreshes the acceptances store so the gate flips
   * immediately. Idempotent on the audit side; safe to retry. No
   * household columns are written (those were dropped in 0043).
   */
  acceptDisclaimer: (documentId: DisclosureDocumentId, version: string) => Promise<void>;
}

export const useHouseholdStore = create<HouseholdState>((set, get) => ({
  household: null,
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new HouseholdRepo(getDatabase());
      const household = await repo.get();
      set({ household, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  update: async (patch) => {
    set({ isLoading: true, error: null });
    try {
      const repo = new HouseholdRepo(getDatabase());
      await repo.update(patch);
      const household = await repo.get();
      set({ household, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to update' });
      throw e;
    }
  },

  acceptDisclaimer: async (documentId, version) => {
    const householdId = get().household?.id ?? 1;
    const acceptedAt = new Date().toISOString();
    const db = getDatabase();
    const acceptancesRepo = new DisclosureAcceptancesRepo(db);

    // Single source of truth (MF-1/T5): the only write is the audit row
    // in disclosure_acceptances — no household cache column to keep in
    // sync (dropped in 0043). The insert is idempotent per (household,
    // document, version), so a retry is a no-op. The BEGIN/COMMIT wrap
    // is retained for consistency with the import/commit/*.ts pattern and
    // so any future second write here stays atomic; rollback on any throw.
    await db.execute('BEGIN');
    try {
      await acceptancesRepo.record({ householdId, documentId, version, acceptedAt });
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }

    // Single source of truth: the gate reads the acceptances store, which
    // projects disclosure_acceptances. Refresh it after the audit row commits
    // so the gate flips immediately. Swallow errors — the audit row is
    // durable; the next boot reconciles.
    try {
      await useAcceptancesStore.getState().load();
    } catch {
      // ignore — gate will reconcile on next load
    }
  },
}));
