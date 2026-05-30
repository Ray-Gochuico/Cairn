import { create } from 'zustand';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';
import { getDatabase } from '@/db/db';

/**
 * In-memory projection of the disclosure_acceptances audit table: the latest
 * accepted version per document id. This is the gate's fast-path read,
 * replacing the per-disclosure household cache columns (MF-1). Boot-loaded by
 * AppDisclaimerGate and refreshed by acceptDisclaimer; serves every
 * useDisclosureGate call synchronously from memory.
 *
 * `status` is explicit (`loading` | `ready` | `error`) because the app_wide
 * gate must FAIL CLOSED on a transient load failure (TR-2, Legal M1): an empty
 * `acceptedVersions` is ambiguous — it is genuine-first-run OR a load that
 * errored. `status` disambiguates so AppDisclaimerGate never renders
 * un-consented content to a returning user owed a re-prompt. The catch sets
 * `'error'` (it previously only set the swallowed `error` string).
 */
interface AcceptancesState {
  acceptedVersions: Record<string, string>;
  status: 'loading' | 'ready' | 'error';
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useAcceptancesStore = create<AcceptancesState>((set) => ({
  acceptedVersions: {},
  status: 'loading',
  isLoading: false,
  error: null,
  load: async () => {
    set({ status: 'loading', isLoading: true, error: null });
    try {
      const repo = new DisclosureAcceptancesRepo(getDatabase());
      const acceptedVersions = await repo.latestVersionsByDocument();
      set({ acceptedVersions, status: 'ready', isLoading: false });
    } catch (e) {
      // FAIL CLOSED: surface the error as `status: 'error'` so the app_wide
      // gate re-presents the disclosure rather than assuming first-run.
      set({ status: 'error', isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },
}));
