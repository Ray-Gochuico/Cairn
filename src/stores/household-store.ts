import { create } from 'zustand';
import { HouseholdRepo, type DisclosureDocumentId } from '@/domain/household';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';
import { getDatabase } from '@/db/db';
import type { Household } from '@/types/schema';

interface HouseholdState {
  household: Household | null;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: (patch: Partial<Omit<Household, 'id'>>) => Promise<void>;
  /**
   * Record the user's acceptance of a disclosure version. Writes the
   * cache columns on `household` (fast-path read for the gate) and
   * appends to the disclosure_acceptances audit trail. Idempotent on
   * the audit side; safe to retry.
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
    const householdRepo = new HouseholdRepo(db);
    const acceptancesRepo = new DisclosureAcceptancesRepo(db);

    await householdRepo.updateDisclosure(documentId, version, acceptedAt);
    await acceptancesRepo.record({ householdId, documentId, version, acceptedAt });

    // Re-read household so subscribers see the new cache columns.
    const household = await householdRepo.get();
    set({ household });
  },
}));
