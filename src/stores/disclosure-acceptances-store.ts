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

/**
 * Max time to wait for the projection read before failing closed. This BOUNDS
 * the `AppDisclaimerGate` "Loading…" state so a hung or interrupted DB read can
 * never freeze the whole app on boot. The motivating failure: a `tauri dev`
 * hot-reload mid-boot orphans the in-flight SQL IPC callback, so the underlying
 * `select` promise never settles — without a timeout the gate waits on it
 * forever. On timeout we fail CLOSED (status 'error' → the gate re-presents the
 * app-wide disclosure) rather than hang. Generous enough (8s) that a slow cold
 * read on first launch never false-trips; the happy path resolves in <100ms so
 * the timeout is invisible in normal operation.
 */
const LOAD_TIMEOUT_MS = 8000;

export const useAcceptancesStore = create<AcceptancesState>((set) => ({
  acceptedVersions: {},
  status: 'loading',
  isLoading: false,
  error: null,
  load: async () => {
    set({ status: 'loading', isLoading: true, error: null });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const repo = new DisclosureAcceptancesRepo(getDatabase());
      const acceptedVersions = await Promise.race([
        repo.latestVersionsByDocument(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('acceptances projection load timed out')),
            LOAD_TIMEOUT_MS,
          );
        }),
      ]);
      set({ acceptedVersions, status: 'ready', isLoading: false });
    } catch (e) {
      // FAIL CLOSED: surface the error as `status: 'error'` so the app_wide
      // gate re-presents the disclosure rather than assuming first-run — and so
      // a hung/orphaned read converts to a re-prompt instead of an eternal
      // "Loading…" boot freeze.
      set({ status: 'error', isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  },
}));
