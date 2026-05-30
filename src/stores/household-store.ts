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
    const acceptancesRepo = new DisclosureAcceptancesRepo(getDatabase());

    // Single source of truth (MF-1/T5): the only write is the audit row in
    // disclosure_acceptances — no household cache column to keep in sync
    // (dropped in 0043). A lone INSERT is atomic on its own (SQLite
    // auto-commits a single statement), so we do NOT wrap it in a manual
    // BEGIN/COMMIT: under tauri-plugin-sql's connection pool, a manual BEGIN
    // and COMMIT can be dispatched to DIFFERENT pooled connections when launch
    // work (the background market refresh) is running concurrently, which
    // breaks the commit and makes acceptance fail. record() is idempotent on
    // UNIQUE(household, document, version), so a re-accept is a no-op.
    await acceptancesRepo.record({ householdId, documentId, version, acceptedAt });

    // Flip the gate immediately and OPTIMISTICALLY. The write just succeeded,
    // so we KNOW this version is accepted — set it directly. This is the
    // AUTHORITATIVE update, not a hint: we deliberately do NOT re-read here. A
    // reconcile load() would re-enter `status: 'loading'` and, on a slow or
    // contended projection read, time out to `status: 'error'` — re-prompting
    // the user ~8s after a successful accept. The audit row is the durable
    // source of truth; the next app boot's load() reconciles the projection.
    const prev = useAcceptancesStore.getState().acceptedVersions;
    useAcceptancesStore.setState({
      acceptedVersions: { ...prev, [documentId]: version },
      status: 'ready',
      isLoading: false,
      error: null,
    });
  },
}));
