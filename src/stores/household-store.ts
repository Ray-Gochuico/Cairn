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

    // W7-Data #1: cache columns + audit row must be atomic. Pre-fix
    // this ran the two writes as separate awaits — if the audit insert
    // failed after the cache update succeeded, the household showed
    // "accepted" but the source-of-truth audit trail was missing,
    // breaking the documented invariant "the audit table is the only
    // record that matters; cache is a derived fast-path read".
    //
    // SQLite transaction pattern mirrors the import/commit/*.ts files
    // (db.execute BEGIN ... COMMIT, rollback on any throw).
    await db.execute('BEGIN');
    try {
      await householdRepo.updateDisclosure(documentId, version, acceptedAt);
      await acceptancesRepo.record({ householdId, documentId, version, acceptedAt });
      await db.execute('COMMIT');
    } catch (err) {
      await db.execute('ROLLBACK');
      throw err;
    }

    // Smoke-test 2026-05-27 finding: when the post-COMMIT cache rehydration
    // throws (observed once on the live Tauri build — likely a transient
    // tauri-plugin-sql pool/SELECT race after a write transaction), the
    // error was bubbling up to DisclosureModal as "Failed to record
    // acceptance" even though the writes had already committed. The user
    // saw a misleading failure on a successful accept.
    //
    // Fix: update the Zustand cache OPTIMISTICALLY from the values we
    // just committed. This unblocks the gate immediately. Then attempt a
    // best-effort refresh from the DB to pick up updated_at / any other
    // server-side derived values — swallow any error here; the acceptance
    // is already durable and the next page load will reconcile.
    const current = get().household;
    if (current) {
      const optimistic: Household =
        documentId === 'app_wide'
          ? {
              ...current,
              disclaimerVersionAccepted: version,
              disclaimerAcceptedAt: acceptedAt,
            }
          : {
              ...current,
              roadmapDisclaimerVersionAccepted: version,
              roadmapDisclaimerAcceptedAt: acceptedAt,
            };
      set({ household: optimistic });
    }
    try {
      const fresh = await householdRepo.get();
      if (fresh) set({ household: fresh });
    } catch {
      // Acceptance is durable in DB; surface no UI error. Subsequent
      // store loads will pick up the canonical row.
    }
  },
}));
