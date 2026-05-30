import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { DISCLOSURES, type DisclosureId, type DisclosureDocument } from './disclosures';

export type GateResult =
  | { state: 'ready' }
  | {
      state: 'needs-acceptance';
      document: DisclosureDocument & { id: DisclosureId };
    };

/**
 * Returns whether the user has accepted the *current* version of the
 * given disclosure. Components mount the matching modal when state is
 * `needs-acceptance`.
 *
 * The hook reads the acceptances store (the boot-loaded projection of
 * disclosure_acceptances — the single source of truth, MF-1); it does
 * NOT read any household cache column (those were dropped in 0043). The
 * read is id-keyed, so the hook is N-way with no per-id branch. If the
 * projection has no row for this id (genuine first-run OR a not-yet-
 * loaded store), returns `needs-acceptance` — caller decides whether to
 * gate UI on that or wait (AppDisclaimerGate short-circuits when the
 * household is null because the wizard owns first-run).
 */
export function useDisclosureGate(id: DisclosureId): GateResult {
  const acceptedVersion = useAcceptancesStore((s) => s.acceptedVersions[id] ?? null);
  const current = DISCLOSURES[id];

  if (acceptedVersion === current.version) {
    return { state: 'ready' };
  }
  return {
    state: 'needs-acceptance',
    document: { id, ...current },
  };
}
